// A losing tab has a second route back to the PTY its layout just gave up: its own row `ptyId`,
// which reconnect copies into pendingReconnectPtyIdByTabId and the pane then takes as a fallback.
// This drives the real hydration entry with the STA-7961 pair to pin that route shut.
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn()
}))

const apiProxy = (): unknown =>
  new Proxy(() => undefined, {
    get: (_target, prop) => (prop === 'then' ? undefined : apiProxy()),
    apply: () => Promise.resolve(null)
  })

// @ts-expect-error -- mocked browser preload API
globalThis.window = { api: apiProxy() }

import { createTestStore, makeTab, makeWorktree, seedStore } from '../slices/store-test-helpers'

const WORKTREE_ID = 'repo1::/wt-1'
const SPLIT_TAB_ID = 'eba00a9a-17df-4152-8258-42381b48890a'
const SINGLE_TAB_ID = '881a9ee2-7143-46c8-98ac-8ffbb9cf4b2c'
const SHARED_LEAF_ID = '10cb5648-8a54-41c0-a6a4-ef0028d93599'
const OWN_LEAF_ID = 'df8913c9-fd8a-420a-a7d6-17daf0ed30f0'
const SHARED_PTY_ID = 'repo1::/wt-1@@289ed0f2'
const SPLIT_OWN_PTY_ID = 'repo1::/wt-1@@eaff6e99'
const LEGACY_TAB_ID = '4b0f3f05-5e9e-4a2e-9f3a-6f1f3a4b7c21'
const LEGACY_LEAF_ID = '7c1a8d2e-2f44-4a7b-93b6-10c6a1f9d0b4'
const LEGACY_PTY_ID = 'repo1::/wt-1@@legacy01'

function baseSession(): WorkspaceSessionState {
  return {
    activeRepoId: 'repo1',
    activeWorktreeId: WORKTREE_ID,
    activeTabId: SINGLE_TAB_ID,
    activeWorktreeIdsOnShutdown: [WORKTREE_ID],
    tabsByWorktree: { [WORKTREE_ID]: [] },
    terminalLayoutsByTabId: {}
  }
}

/** The persisted pair from the report: both tabs bind the same leaf to the same PTY. */
function duplicateLeafSession(): WorkspaceSessionState {
  return {
    ...baseSession(),
    tabsByWorktree: {
      [WORKTREE_ID]: [
        makeTab({
          id: SPLIT_TAB_ID,
          worktreeId: WORKTREE_ID,
          ptyId: SPLIT_OWN_PTY_ID,
          sortOrder: 0,
          createdAt: 1_789_867_969_623
        }),
        makeTab({
          id: SINGLE_TAB_ID,
          worktreeId: WORKTREE_ID,
          ptyId: SHARED_PTY_ID,
          sortOrder: 1,
          createdAt: 1_789_867_969_624
        })
      ]
    },
    terminalLayoutsByTabId: {
      [SPLIT_TAB_ID]: {
        root: {
          type: 'split',
          direction: 'vertical',
          first: { type: 'leaf', leafId: OWN_LEAF_ID },
          second: { type: 'leaf', leafId: SHARED_LEAF_ID }
        },
        activeLeafId: SHARED_LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [OWN_LEAF_ID]: SPLIT_OWN_PTY_ID, [SHARED_LEAF_ID]: SHARED_PTY_ID }
      },
      [SINGLE_TAB_ID]: {
        root: { type: 'leaf', leafId: SHARED_LEAF_ID },
        activeLeafId: SHARED_LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [SHARED_LEAF_ID]: SHARED_PTY_ID }
      }
    }
  }
}

/** A profile written before per-leaf bindings existed: a tree, and no bindings map at all. */
function legacyLayoutSession(): WorkspaceSessionState {
  return {
    ...baseSession(),
    activeTabId: LEGACY_TAB_ID,
    tabsByWorktree: {
      [WORKTREE_ID]: [makeTab({ id: LEGACY_TAB_ID, worktreeId: WORKTREE_ID, ptyId: LEGACY_PTY_ID })]
    },
    terminalLayoutsByTabId: {
      [LEGACY_TAB_ID]: {
        root: { type: 'leaf', leafId: LEGACY_LEAF_ID },
        activeLeafId: LEGACY_LEAF_ID,
        expandedLeafId: null
      }
    }
  }
}

function hydrate(
  session: WorkspaceSessionState
): ReturnType<ReturnType<typeof createTestStore>['getState']> {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/wt-1' })]
    }
  })
  store.getState().hydrateWorkspaceSession(session)
  return store.getState()
}

describe('hydrating the STA-7961 duplicate binding', () => {
  it('leaves the shared pty bound to one tab only', () => {
    const state = hydrate(duplicateLeafSession())

    expect(state.terminalLayoutsByTabId[SPLIT_TAB_ID]?.ptyIdsByLeafId?.[SHARED_LEAF_ID]).toBe(
      SHARED_PTY_ID
    )
    expect(
      Object.values(state.terminalLayoutsByTabId[SINGLE_TAB_ID]?.ptyIdsByLeafId ?? {})
    ).not.toContain(SHARED_PTY_ID)
  })

  it('keeps the losing row from taking the pty back through its tab-level id', () => {
    const state = hydrate(duplicateLeafSession())

    expect(state.pendingReconnectPtyIdByTabId[SINGLE_TAB_ID]).toBeUndefined()
  })

  it('anchors the winner to what its healed layout binds, not to its row', () => {
    // The winner's row still names its other pane's pty; the anchor follows the active leaf,
    // which is the shared session it just won.
    const state = hydrate(duplicateLeafSession())

    expect(state.pendingReconnectPtyIdByTabId[SPLIT_TAB_ID]).toBe(SHARED_PTY_ID)
    expect(state.terminalLayoutsByTabId[SPLIT_TAB_ID]?.ptyIdsByLeafId?.[OWN_LEAF_ID]).toBe(
      SPLIT_OWN_PTY_ID
    )
  })

  it('keeps both rows and the losing tab keeps its pane', () => {
    const state = hydrate(duplicateLeafSession())

    expect(state.tabsByWorktree[WORKTREE_ID]?.map((tab) => tab.id)).toEqual([
      SPLIT_TAB_ID,
      SINGLE_TAB_ID
    ])
    expect(state.terminalLayoutsByTabId[SINGLE_TAB_ID]?.root).toEqual({
      type: 'leaf',
      leafId: SHARED_LEAF_ID
    })
  })

  it('a legacy layout with a tree but no bindings map still reconnects through the row', () => {
    // Nothing migrates tab.ptyId into ptyIdsByLeafId, so this shape survives on disk and the
    // row is the only thing that names its session. An absent map, not an empty one, marks it.
    const state = hydrate(legacyLayoutSession())

    expect(state.terminalLayoutsByTabId[LEGACY_TAB_ID]?.ptyIdsByLeafId).toBeUndefined()
    expect(state.pendingReconnectPtyIdByTabId[LEGACY_TAB_ID]).toBe(LEGACY_PTY_ID)
  })
})
