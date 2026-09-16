import { afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../src/main/persistence/loading-store/store'
import {
  createTestStore,
  seedStore,
  makeTab,
  makeWorktree
} from '../../../src/renderer/src/store/slices/store-test-helpers'
import { createStoreCascadesMockApi } from '../../../src/renderer/src/store/slices/store-cascades-test-harness'
import { buildWorkspaceSessionPayload } from '../../../src/renderer/src/lib/workspace-session'
import { buildWorkspaceSessionPatch } from '../../../src/renderer/src/lib/workspace-session-patch'
import { hydrateWorkspaceTerminalRows } from '../../../src/renderer/src/store/slices/terminal-session-row-hydration'
import { retireTerminalSurfaceFromPersistence } from '../../../src/main/runtime/mobile-session-terminal-persistence-retirement'
import { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import { buildHeadlessMobileSessionTerminalTabs } from '../../../src/main/runtime/mobile-session-terminal-projection'
import type { AppState } from '../../../src/renderer/src/store/types'
const WT = 'repo1::/tmp/worktree'
const UNBOUND = '11111111-1111-4111-8111-111111111111'
const BOUND = '22222222-2222-4222-8222-222222222222'
const LEAF = '33333333-3333-4333-8333-333333333333'
type CloseResult = Awaited<ReturnType<OrcaRuntimeService['closeMobileSessionTab']>>
const rows: {
  scenario: string
  runtimeResult: CloseResult | undefined
  priorRevision: number
  killRequests: number
  rendererHasTab: boolean
  patchHasTab: boolean
  mainHasTab: boolean
  diskHasTab: boolean
  rehydratedHasTab: boolean
  closedTombstones: AppState['closedTerminalTabTombstonesByTabId']
}[] = []
for (const scenario of [
  'revision-zero',
  'sibling-exited',
  'target-retired',
  'runtime-headless-close',
  'runtime-renderer-close',
  'runtime-renderer-late-graph'
]) {
  it(scenario, async () => {
    const api = createStoreCascadesMockApi()
    const renderer = createTestStore()
    const bound = makeTab({ id: BOUND, worktreeId: WT, ptyId: 'pty-sibling' })
    seedStore(renderer, {
      activeRepoId: 'repo1',
      activeWorktreeId: WT,
      activeTabId: UNBOUND,
      worktreesByRepo: {
        repo1: [makeWorktree({ id: WT, repoId: 'repo1', path: '/tmp/worktree' })]
      },
      tabsByWorktree: { [WT]: [bound] },
      terminalLayoutsByTabId: {
        [BOUND]: {
          root: { type: 'leaf', leafId: LEAF },
          activeLeafId: LEAF,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF]: 'pty-sibling' }
        }
      }
    })
    renderer.getState().createTab(WT, undefined, undefined, { id: UNBOUND, activate: false })
    expect(renderer.getState().tabsByWorktree[WT].find((t) => t.id === UNBOUND)?.ptyId).toBe(null)
    const dir = mkdtempSync(join(tmpdir(), 'orca-tab-rebase-'))
    const file = join(dir, 'orca-data.json')
    const main = new Store({ dataFile: file })
    try {
      main.addRepo(renderer.getState().repos[0])
      main.setWorkspaceSession(buildWorkspaceSessionPayload(renderer.getState()))
      expect(main.getWorkspaceSession().tabsByWorktree[WT].map((t) => t.id)).toContain(UNBOUND)
      if (scenario !== 'revision-zero') {
        main.setWorkspaceSession(
          retireTerminalSurfaceFromPersistence(main.getWorkspaceSession(), {
            worktreeId: WT,
            parentTabId: BOUND,
            leafId: LEAF,
            ptyId: 'pty-sibling'
          })
        )
      }
      if (scenario === 'target-retired') {
        // Genuine authority removal control: explicitly retire host membership with a newer topology revision.
        const current = main.getWorkspaceSession()
        main.setWorkspaceSession({
          ...current,
          tabsByWorktree: { [WT]: [] },
          terminalTopologyRevisionByRepoId: { repo1: 2 }
        })
      }
      const before = main.getWorkspaceSession()
      let runtimeResult: CloseResult | undefined
      if (scenario.startsWith('runtime-')) {
        const runtime = new OrcaRuntimeService(main)
        if (scenario.startsWith('runtime-renderer')) {
          runtime.attachWindow(1)
          const tabs = buildHeadlessMobileSessionTerminalTabs(
            WT,
            main.getWorkspaceSession().tabsByWorktree[WT],
            main.getWorkspaceSession()
          )
          runtime.syncWindowGraph(1, {
            tabs: [
              { tabId: UNBOUND, worktreeId: WT, title: 'Unbound', activeLeafId: null, layout: null }
            ],
            leaves: [],
            mobileSessionTabs: [
              {
                worktree: WT,
                publicationEpoch: 'renderer-unbound',
                snapshotVersion: 1,
                activeTabId: tabs[0].id,
                activeTabType: 'terminal',
                tabs
              }
            ]
          })
          const notifier = {
            closeTerminalTab: async () => {
              renderer.getState().closeTab(UNBOUND)
              if (scenario === 'runtime-renderer-close') {
                runtime.syncWindowGraph(1, {
                  tabs: [],
                  leaves: [],
                  mobileSessionTabs: [
                    {
                      worktree: WT,
                      publicationEpoch: 'renderer-unbound',
                      snapshotVersion: 2,
                      activeTabId: null,
                      activeTabType: null,
                      tabs: []
                    }
                  ]
                })
              }
              main.setWorkspaceSession(buildWorkspaceSessionPayload(renderer.getState()))
              main.flush()
            },
            closeTerminal: () => {}
          }
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture exercises only the two terminal-close notifier ports.
          runtime.setNotifier(notifier as never)
        }
        runtimeResult = await runtime.closeMobileSessionTab(`id:${WT}`, UNBOUND, { reason: 'user' })
        if (scenario === 'runtime-renderer-late-graph') {
          runtime.syncWindowGraph(1, {
            tabs: [],
            leaves: [],
            mobileSessionTabs: [
              {
                worktree: WT,
                publicationEpoch: 'renderer-unbound',
                snapshotVersion: 2,
                activeTabId: null,
                activeTabType: null,
                tabs: []
              }
            ]
          })
        }
        runtime.setNotifier(null)
      }
      renderer.getState().closeTab(UNBOUND)
      const patch = buildWorkspaceSessionPatch(renderer.getState(), [
        'tabsByWorktree',
        'terminalLayoutsByTabId',
        'activeTabIdByWorktree',
        'unifiedTabsByWorktree',
        'groupsByWorktree',
        'layoutByWorktree'
      ])
      main.patchWorkspaceSession(patch)
      main.flush()
      const restarted = new Store({ dataFile: file })
      const saved = restarted.getWorkspaceSession()
      restarted.flush()
      rows.push({
        scenario,
        runtimeResult,
        priorRevision: before.terminalTopologyRevisionByRepoId?.repo1 ?? 0,
        killRequests: api.pty.kill.mock.calls.length,
        rendererHasTab: renderer.getState().tabsByWorktree[WT].some((t) => t.id === UNBOUND),
        patchHasTab: patch.tabsByWorktree?.[WT]?.some((t) => t.id === UNBOUND) ?? false,
        mainHasTab: main.getWorkspaceSession().tabsByWorktree[WT].some((t) => t.id === UNBOUND),
        diskHasTab: saved.tabsByWorktree[WT].some((t) => t.id === UNBOUND),
        rehydratedHasTab: hydrateWorkspaceTerminalRows(
          saved,
          WT,
          saved.tabsByWorktree[WT]
        ).rows.some((t) => t.id === UNBOUND),
        closedTombstones: renderer.getState().closedTerminalTabTombstonesByTabId
      })
      expect(api.pty.kill).not.toHaveBeenCalled()
      expect(renderer.getState().tabsByWorktree[WT].some((t) => t.id === UNBOUND)).toBe(false)
      expect(saved.tabsByWorktree[WT].some((t) => t.id === UNBOUND)).toBe(
        ['sibling-exited', 'runtime-renderer-late-graph'].includes(scenario)
      )
    } finally {
      main.flush()
      rmSync(dir, { recursive: true, force: true })
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
}

afterAll(() => {
  const output = process.env.ORCA_LOCAL_TAB_CLOSE_REBASE_OUTPUT
  if (!output) {
    throw new Error('Run this proof with reproduce.mjs')
  }
  writeFileSync(output, JSON.stringify(rows))
})
