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

/** The rows as the pane attach paths read them: they take `tab.ptyId` straight off the store. */
function rowPtyIdsAfterReconnect(
  session: WorkspaceSessionState
): Promise<(string | null | undefined)[]> {
  const store = createTestStore()
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/wt-1' })]
    }
  })
  store.getState().hydrateWorkspaceSession(session)
  return store
    .getState()
    .reconnectPersistedTerminals()
    .then(() => (store.getState().tabsByWorktree[WORKTREE_ID] ?? []).map((tab) => tab.ptyId))
}

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

  it('never lets the losing row name the surrendered pty, at hydration or after reconnect', async () => {
    // The pane attach paths read the row directly: the local reattach choice takes it as
    // `tabFallbackPtyId` (deferred-session-reattach-choice.ts), and the SSH gate promotes it to
    // `pendingSessionId` once the leaf map reads empty (ssh-pane-connect-gate.ts). Hydration
    // clears every row, and reconnect must not hand this one back.
    expect(
      hydrate(duplicateLeafSession()).tabsByWorktree[WORKTREE_ID]?.map((tab) => tab.ptyId)
    ).toEqual([null, null])
    await expect(rowPtyIdsAfterReconnect(duplicateLeafSession())).resolves.toEqual([
      SHARED_PTY_ID,
      null
    ])
  })

  it('refuses a relay wake handle that names a pty another tab\u2019s layout binds', async () => {
    // remoteSessionIdsByTabId is persisted from the row, so a profile saved before the heal
    // still names the shared session there — a second door onto the same duplicate mount.
    const session = {
      ...duplicateLeafSession(),
      remoteSessionIdsByTabId: { [SINGLE_TAB_ID]: SHARED_PTY_ID }
    }

    expect(hydrate(session).pendingReconnectPtyIdByTabId[SINGLE_TAB_ID]).toBeUndefined()
    await expect(rowPtyIdsAfterReconnect(session)).resolves.toEqual([SHARED_PTY_ID, null])
  })

  it('still wakes a relay session only a stranded binding names', async () => {
    // The split tab's map still names the pty at a leaf its tree dropped, so it reattaches
    // nothing. Blocking on that would cost the single tab a real remote restore for no gain.
    const strandedPty = 'repo1::/wt-1@@relay-stranded'
    const base = duplicateLeafSession()
    const splitLayout = base.terminalLayoutsByTabId[SPLIT_TAB_ID]!
    const session: WorkspaceSessionState = {
      ...base,
      remoteSessionIdsByTabId: { [SINGLE_TAB_ID]: strandedPty },
      terminalLayoutsByTabId: {
        ...base.terminalLayoutsByTabId,
        [SPLIT_TAB_ID]: {
          ...splitLayout,
          ptyIdsByLeafId: {
            ...splitLayout.ptyIdsByLeafId,
            'ac1f6d20-1f3e-4c58-8f2b-0a9e7d4c3b15': strandedPty
          }
        }
      }
    }

    expect(hydrate(session).pendingReconnectPtyIdByTabId[SINGLE_TAB_ID]).toBe(strandedPty)
  })

  it('still wakes a relay session nothing else binds', async () => {
    const session = {
      ...duplicateLeafSession(),
      remoteSessionIdsByTabId: { [SINGLE_TAB_ID]: 'repo1::/wt-1@@relay-own' }
    }

    expect(hydrate(session).pendingReconnectPtyIdByTabId[SINGLE_TAB_ID]).toBe(
      'repo1::/wt-1@@relay-own'
    )
  })

  it('a legacy layout with a tree but no bindings map still reconnects through the row', () => {
    // Nothing migrates tab.ptyId into ptyIdsByLeafId, so this shape survives on disk and the
    // row is the only thing that names its session. An absent map, not an empty one, marks it.
    const state = hydrate(legacyLayoutSession())

    expect(state.terminalLayoutsByTabId[LEGACY_TAB_ID]?.ptyIdsByLeafId).toBeUndefined()
    expect(state.pendingReconnectPtyIdByTabId[LEGACY_TAB_ID]).toBe(LEGACY_PTY_ID)
  })
})
