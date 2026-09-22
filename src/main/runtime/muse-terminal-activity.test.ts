import { describe, expect, it, vi } from 'vitest'
import { makeAgentStatusStoreWiring } from './agent-status-store-wiring.test-fixture'
import { createTranscriptPane } from './agent-transcript-pane-test-harness'
import { clearMuseTerminalActivity, nextMuseTerminalStatus } from './muse-terminal-activity'
import {
  detectTerminalWaitBlockedReason,
  isKnownReadyPromptPreview
} from './terminal-wait-detection'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const READY = ['Muse Code 1.3.0', '❯', 'echo · ~/repo · Auto-review'].join('\n')
const WORKING = ['Muse Code 1.3.0', 'Running', 'reading the repo'].join('\n')
const QUESTION = [
  'Request user input',
  '1. Ship it',
  '2. Stop',
  'Enter to select · Tab for an optional note · Esc to interrupt'
].join('\n')

const TRUST = [
  'Do you trust this workspace?',
  'Workspace:',
  '/repo/app',
  'Only trust this workspace when you trust its contents.',
  '> 1  Trust and continue',
  '  2  Quit',
  'Use Up/Down or 1/2, then Enter. Esc quits.'
].join('\n')

const APPROVAL = [
  'Allow once',
  'Reject once',
  'Allow for this session',
  'Block for this session'
].join('\n')

describe('Muse screen classification', () => {
  it('accepts the ready composer and a live question, not a stale banner or narration', () => {
    expect(isKnownReadyPromptPreview(READY)).toBe(true)
    expect(isKnownReadyPromptPreview('Muse Code 1.3.0\nstarting')).toBe(false)
    expect(detectTerminalWaitBlockedReason(TRUST)).toBe('agent-trust-workspace')
    expect(detectTerminalWaitBlockedReason(QUESTION)).toBe('agent-interactive-prompt')
    expect(detectTerminalWaitBlockedReason(APPROVAL)).toBe('agent-approval-prompt')
    expect(detectTerminalWaitBlockedReason(`${TRUST}\n${READY}`)).toBeNull()
    expect(isKnownReadyPromptPreview(`${TRUST}\n${READY}`)).toBe(true)
    expect(detectTerminalWaitBlockedReason(`${QUESTION}\n${READY}`)).toBeNull()
    const narration = [
      'Muse Code 1.3.0',
      'I described Request user input and Enter to select.',
      '1. Yes was the first choice in the story.',
      '2. No was the other.',
      '❯',
      'echo · ~/repo · Auto-review'
    ].join('\n')
    expect(detectTerminalWaitBlockedReason(narration)).toBeNull()
    const prose = [
      'request user input',
      '1. Yes',
      '2. No',
      'enter to select',
      'and then the agent kept talking about the menu.'
    ].join('\n')
    expect(detectTerminalWaitBlockedReason(prose)).toBeNull()
  })
})

describe('Muse terminal status', () => {
  it('publishes waiting, then working, then ready through the status store', async () => {
    clearMuseTerminalActivity('pty-status')
    expect(nextMuseTerminalStatus('pty-first-ready', READY)).toMatchObject({
      state: 'done',
      sessionBoundary: true
    })
    clearMuseTerminalActivity('pty-first-ready')
    expect(nextMuseTerminalStatus('pty-status', QUESTION)).toMatchObject({
      state: 'waiting',
      agentType: 'muse'
    })
    expect(nextMuseTerminalStatus('pty-status', WORKING)).toMatchObject({ state: 'working' })
    const finished = nextMuseTerminalStatus('pty-status', READY)
    expect(finished?.state).toBe('done')
    expect(finished?.sessionBoundary).toBeUndefined()
    clearMuseTerminalActivity('pty-status')

    const wiring = makeAgentStatusStoreWiring()
    await createTranscriptPane(
      {
        paneTitle: 'Muse',
        foregroundProcess: 'muse-bin-1.3.0',
        launchAgent: 'muse',
        data: QUESTION
      },
      wiring.deps
    )
    expect(wiring.statusStore.getStatusSnapshot()).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'waiting', agentType: 'muse' })])
    )
  })
})
