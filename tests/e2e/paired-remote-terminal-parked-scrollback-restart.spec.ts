/**
 * Does a parked remote pane's scrollback survive a full client restart?
 *
 * The within-session case is covered by paired-remote-terminal-parked-scrollback-survives.spec.ts.
 * This quits the paired client and relaunches it on the SAME profile — the shape of an app update —
 * and reports, at each hop, whether the park capture is still there:
 *
 *   storeAtPark        -> the capture ran
 *   onDiskAfterQuit    -> persistence kept it
 *   storeAfterRelaunch -> load + sync kept it
 *   tokenAfterReveal   -> the user sees it
 *
 * The first hop that reads zero is where a fix belongs.
 *
 * Why the shutdown is spelled out rather than using the client's own `dispose()`: dispose calls
 * removeProfile(userDataDir), which turns "relaunch on the same profile" into a first run on an
 * empty one — every hop then reads zero and looks exactly like data loss. An earlier version of
 * this spec made that mistake and reported a phantom bug. A raw `app.close()` is not the fix
 * either: it has no timeout and no force-kill fallback, and hung past the test deadline.
 *
 * Run:
 *   pnpm exec playwright test \
 *     tests/e2e/paired-remote-terminal-parked-scrollback-restart.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --workers=1
 */
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import {
  callEnvironment,
  createPairedHostTerminal,
  openPairedClientTab,
  waitForPairedPaneMarker
} from './helpers/paired-host-terminal'
import { focusActiveTerminalInput } from './helpers/terminal'
import { waitForTabParked } from './helpers/terminal-hidden-parking'

const PARK_DELAY_MS = 2_000
const PAINT_BUDGET_MS = 30_000
const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-parked-restart-'))
const fixturePath = path.join(scratch, 'echo-terminal.mjs')
writeFileSync(
  fixturePath,
  [
    "process.stdout.write('READY\\r\\n')",
    "process.stdin.setEncoding('utf8')",
    "let pending = ''",
    "process.stdin.on('data', (data) => {",
    '  pending += data',
    '  const lines = pending.split(/\\r\\n|\\r|\\n/)',
    "  pending = lines.pop() ?? ''",
    '  for (const line of lines) {',
    '    process.stdout.write(`LINE:${line}\\r\\n`)',
    '  }',
    '})',
    'process.stdin.resume()'
  ].join('\n')
)

test.afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function fixtureCommand(): string {
  const command = [process.execPath, fixturePath]
  return process.platform === 'win32'
    ? command.map((value) => `"${value.replaceAll('"', '""')}"`).join(' ')
    : command.map((value) => `'${value.replaceAll("'", `'\\''`)}'`).join(' ')
}

/** -1 means no session file was found at all — a reader problem, not an empty buffer. */
function readOnDiskBufferLength(userDataDir: string, webTabId: string): number {
  let best = -1
  for (const file of globSync(path.join(userDataDir, '**', 'orca-data.json'))) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) {
        continue
      }
      for (const session of Object.values(parsed)) {
        if (typeof session !== 'object' || session === null) {
          continue
        }
        if (!('terminalLayoutsByTabId' in session)) {
          continue
        }
        const layouts = session.terminalLayoutsByTabId
        if (typeof layouts !== 'object' || layouts === null) {
          continue
        }
        best = Math.max(best, 0)
        const layout = (layouts as Record<string, unknown>)[webTabId]
        if (typeof layout !== 'object' || layout === null || !('buffersByLeafId' in layout)) {
          continue
        }
        const buffers = layout.buffersByLeafId as Record<string, string> | undefined
        best = Math.max(best, Object.values(buffers ?? {}).join('').length)
      }
    } catch {
      // A partially written profile is itself a datapoint; keep scanning the rest.
    }
  }
  return best
}

async function readStoreBufferLength(page: Page, webTabId: string): Promise<number> {
  return page.evaluate((id) => {
    const layout = window.__store?.getState().terminalLayoutsByTabId?.[id]
    return Object.values(layout?.buffersByLeafId ?? {}).join('').length
  }, webTabId)
}

test.describe('host retains nothing', () => {
  test.use({
    orcaAppExtraEnv: { ORCA_E2E_FORCE_REMOTE_TERMINAL_SNAPSHOT_UNAVAILABLE: '1' }
  })

  test('keeps a parked pane’s scrollback across a client restart', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(600_000)
    const offer = await createRuntimeDesktopPairingOffer(orcaPage)
    const extraEnv = { ORCA_E2E_TERMINAL_PARKING_DELAY_MS: String(PARK_DELAY_MS) }
    const first = await launchPairedElectronClient(offer, testInfo, 'parked-restart', { extraEnv })
    const userDataDir = first.userDataDir
    let relaunched: PairedElectronClient | null = null
    const createdTerminals: string[] = []
    try {
      const worktreeId = await orcaPage.evaluate(() => {
        const id = window.__store?.getState().activeWorktreeId
        if (!id) {
          throw new Error('headed host has no active worktree')
        }
        return id
      })
      await expect
        .poll(
          () =>
            first.page.evaluate(
              (id) =>
                window.__store
                  ?.getState()
                  .allWorktrees()
                  .some((worktree) => worktree.id === id) ?? false,
              worktreeId
            ),
          { timeout: 60_000, message: 'paired client never saw the host worktree' }
        )
        .toBe(true)
      await first.page.evaluate((id) => {
        const state = window.__store?.getState()
        state?.setActiveView('terminal')
        state?.setActiveWorktree(id)
      }, worktreeId)

      const target = await createPairedHostTerminal(
        first.page,
        first.environmentId,
        worktreeId,
        fixtureCommand()
      )
      const decoys = [
        await createPairedHostTerminal(
          first.page,
          first.environmentId,
          worktreeId,
          fixtureCommand()
        ),
        await createPairedHostTerminal(
          first.page,
          first.environmentId,
          worktreeId,
          fixtureCommand()
        )
      ]
      createdTerminals.push(target.terminal, ...decoys.map((decoy) => decoy.terminal))

      await openPairedClientTab(first.page, worktreeId, target.webTabId)
      await waitForPairedPaneMarker(first.page, target.webTabId, 'READY', PAINT_BUDGET_MS)
      const token = `LINE:token-${randomUUID()}`
      await focusActiveTerminalInput(first.page)
      await first.page.keyboard.type(token.slice('LINE:'.length))
      await first.page.keyboard.press('Enter')
      const tokenBeforePark = await waitForPairedPaneMarker(
        first.page,
        target.webTabId,
        token,
        PAINT_BUDGET_MS
      )

      await openPairedClientTab(first.page, worktreeId, decoys[0].webTabId)
      await openPairedClientTab(first.page, worktreeId, decoys[1].webTabId)
      await waitForTabParked(first.page, target.webTabId, { parkDelayMs: PARK_DELAY_MS })
      const storeAtPark = await readStoreBufferLength(first.page, target.webTabId)

      await first.page.evaluate(() => window.dispatchEvent(new Event('beforeunload')))
      await closeElectronAppForE2E(first.app)
      await cleanupE2EDaemons(userDataDir)
      const onDiskAfterQuit = readOnDiskBufferLength(userDataDir, target.webTabId)

      relaunched = await launchPairedElectronClient(offer, testInfo, 'parked-restart-relaunch', {
        extraEnv,
        reuseUserDataDir: userDataDir
      })
      await relaunched.page.evaluate((id) => {
        const state = window.__store?.getState()
        state?.setActiveView('terminal')
        state?.setActiveWorktree(id)
      }, worktreeId)
      const storeAfterRelaunch = await readStoreBufferLength(relaunched.page, target.webTabId)

      await openPairedClientTab(relaunched.page, worktreeId, target.webTabId)
      const tokenAfterReveal = await waitForPairedPaneMarker(
        relaunched.page,
        target.webTabId,
        token,
        PAINT_BUDGET_MS
      )

      console.log(
        `[parked-restart] ${JSON.stringify({
          tokenBeforePark,
          storeAtPark,
          onDiskAfterQuit,
          storeAfterRelaunch,
          tokenAfterReveal
        })}`
      )
      expect({
        tokenBeforePark,
        capturedAtPark: storeAtPark > 0,
        profileSurvived: onDiskAfterQuit >= 0,
        tokenAfterReveal
      }).toEqual({
        tokenBeforePark: true,
        capturedAtPark: true,
        // Pins the harness: a deleted profile reads -1 and would make every later hop look like
        // data loss. This assertion is what stops that mistake recurring.
        profileSurvived: true,
        tokenAfterReveal: true
      })
    } finally {
      const live = relaunched
      for (const terminal of createdTerminals) {
        await callEnvironment(
          (live ?? first).page,
          (live ?? first).environmentId,
          'terminal.closeTab',
          { terminal }
        ).catch(() => undefined)
      }
      await (live ?? first).dispose().catch(() => undefined)
    }
  })
})
