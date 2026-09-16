import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

/**
 * Closing a tab is not a handover to a new publisher.
 *
 * Every other headless writer carries the stored `publicationEpoch` forward and mints one only when
 * there is no snapshot to inherit from. The close minted unconditionally, so an ordinary close
 * published a stranger's epoch for a worktree the renderer generation still owns. A paired client
 * retires the epoch it displaces, and the web mirror's retirement is final — so the renderer's next
 * publication, carrying the epoch the close had just retired, was rejected forever. The user
 * emptied a workspace, created a terminal, and watched it never arrive.
 */
const WORKTREE_ID = 'repo-1::/tmp/headless-close'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const LIVE_EPOCH = 'renderer-generation-1'

function makeStore() {
  const session = getDefaultWorkspaceSession()
  return {
    getWorkspaceSession: vi.fn(() => session),
    setWorkspaceSession: vi.fn(),
    flushOrThrow: vi.fn(),
    getRepos: vi.fn(() => [
      {
        id: 'repo-1',
        path: '/tmp/headless-close',
        displayName: 'headless',
        badgeColor: '#000000',
        addedAt: 0
      }
    ]),
    getAllWorktreeMeta: vi.fn(() => ({})),
    getWorktreeMeta: vi.fn(() => undefined),
    setWorktreeMeta: vi.fn(),
    removeWorktreeMeta: vi.fn(),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' })),
    getProjects: vi.fn(() => [])
  }
}

function terminalTab(parentTabId: string, leafId: string) {
  return {
    type: 'terminal' as const,
    id: `${parentTabId}::${leafId}`,
    parentTabId,
    leafId,
    title: 'Terminal',
    isActive: true,
    status: 'ready' as const,
    terminal: `term_${parentTabId}`
  }
}

/** A worktree the live renderer generation published, holding two terminals. */
function storedSnapshot(): RuntimeMobileSessionTabsSnapshot {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this suite reads only the epoch, version and tabs.
  return {
    worktree: WORKTREE_ID,
    publicationEpoch: LIVE_EPOCH,
    snapshotVersion: 4,
    activeGroupId: null,
    activeTabId: `tab-a::${LEAF_ID}`,
    activeTabType: 'terminal',
    tabs: [terminalTab('tab-a', LEAF_ID), terminalTab('tab-b', LEAF_ID)]
  } as RuntimeMobileSessionTabsSnapshot
}

function closeOneTab(): RuntimeMobileSessionTabsSnapshot {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: makeStore covers the reads this suite drives.
  const runtime = new OrcaRuntimeService(makeStore() as never)
  const snapshot = storedSnapshot()
  const internals = runtime as unknown as {
    closeHeadlessMobileTerminalTab: (
      worktreeId: string,
      snapshot: RuntimeMobileSessionTabsSnapshot,
      tab: ReturnType<typeof terminalTab>,
      options?: Record<string, unknown>
    ) => void
    mobileSessionTabsByWorktree: Map<string, RuntimeMobileSessionTabsSnapshot>
  }
  internals.mobileSessionTabsByWorktree.set(WORKTREE_ID, snapshot)
  internals.closeHeadlessMobileTerminalTab(WORKTREE_ID, snapshot, snapshot.tabs[0] as never, {
    allowMissingPersistedTab: true,
    killPtys: false
  })
  return internals.mobileSessionTabsByWorktree.get(WORKTREE_ID) as RuntimeMobileSessionTabsSnapshot
}

describe('closing a headless mobile terminal tab', () => {
  it('keeps the worktree under the epoch that was already publishing it', () => {
    expect(closeOneTab().publicationEpoch).toBe(LIVE_EPOCH)
  })

  it('still advances the version so clients accept the frame', () => {
    const published = closeOneTab()
    expect(published.snapshotVersion).toBe(5)
    expect(published.tabs.map((tab) => tab.id)).toEqual([`tab-b::${LEAF_ID}`])
  })
})
