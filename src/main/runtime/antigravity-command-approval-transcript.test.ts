import { makeAgentStatusStoreWiring } from './agent-status-store-wiring.test-fixture'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTranscriptPane, TRANSCRIPT_PANE_PTY_ID } from './agent-transcript-pane-test-harness'
import { extractLastOscTitle } from '../../shared/osc-title-extraction'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

describe('captured native Windows Antigravity command approval', () => {
  it.each([
    ['approval', false, 'agent-approval-prompt'],
    ['cancelled', true, undefined],
    ['allow-key', true, undefined]
  ] as const)(
    'classifies the recorded %s screen',
    async (name, satisfied, blockedReason) => {
      const transcript = readFileSync(
        join(__dirname, `__fixtures__/antigravity-windows-command-${name}.txt`),
        'utf8'
      )
      const { runtime, handle } = await createTranscriptPane({
        paneTitle: extractLastOscTitle(transcript) ?? 'agy',
        foregroundProcess: 'agy',
        size: { cols: 120, rows: 40 },
        data: transcript
      })
      const result = await runtime.waitForTerminal(handle, {
        condition: 'tui-idle',
        timeoutMs: 3500
      })
      expect(result.satisfied).toBe(satisfied)
      if (!satisfied) {
        expect(result).toMatchObject({ blockedReason })
      }
    },
    10000
  )
})

it('publishes the captured permission and cancellation to the canonical hook store', async () => {
  const wiring = makeAgentStatusStoreWiring()
  const { runtime, handle } = await createTranscriptPane(
    {
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      size: { cols: 120, rows: 40 },
      data: ''
    },
    wiring.deps
  )
  const paneKey = runtime.getTerminalPaneKey(handle)
  if (!paneKey) {
    throw new Error('Missing test pane key')
  }
  wiring.statusStore.ingestTerminalStatus({
    paneKey,
    payload: {
      state: 'working',
      agentType: 'antigravity',
      prompt: 'print marker',
      toolName: 'run_command'
    }
  })
  const approval = readFileSync(
    join(__dirname, '__fixtures__/antigravity-windows-command-approval.txt'),
    'utf8'
  )
  runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, approval, Date.now())
  await vi.waitFor(() =>
    expect(wiring.statusStore.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      observation: { origin: 'process' }
    })
  )
  expect(wiring.statusStore.getStatusSnapshot()[0].interactivePrompt).toContain(
    'ORCA_PERMISSION_CAPTURE_OK'
  )
  const cancelled = readFileSync(
    join(__dirname, '__fixtures__/antigravity-windows-command-cancelled.txt'),
    'utf8'
  )
  runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, cancelled, Date.now())
  await vi.waitFor(() =>
    expect(wiring.statusStore.getStatusSnapshot()[0]).toMatchObject({ state: 'done' })
  )
  expect(wiring.statusStore.getStatusSnapshot()[0].interactivePrompt).toBeUndefined()
})
