import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTranscriptPane } from './agent-transcript-pane-test-harness'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import { hasEmptyTerminalComposer } from '../../shared/terminal-composer-draft'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

async function replay(name: string): Promise<HeadlessEmulator> {
  const terminal = new HeadlessEmulator({ cols: 100, rows: 32, scrollback: 100 })
  const data = readFileSync(join(__dirname, '__fixtures__', `${name}.txt`), 'utf8')
  await terminal.write(data)
  return terminal
}

describe('captured Claude composer readiness', () => {
  it.each(['claude-bypass-dialog', 'claude-bypass-paste-exit'])(
    'does not admit a prompt at %s',
    async (name) => {
      const terminal = await replay(name)
      try {
        expect(hasEmptyTerminalComposer(terminal.getCursorLineContext())).toBe(false)
      } finally {
        terminal.dispose()
      }
    }
  )

  it('admits the composer after the user dismisses the warning', async () => {
    const terminal = await replay('claude-bypass-to-composer')
    try {
      expect(hasEmptyTerminalComposer(terminal.getCursorLineContext())).toBe(true)
      await terminal.write('existing draft')
      expect(hasEmptyTerminalComposer(terminal.getCursorLineContext())).toBe(false)
    } finally {
      terminal.dispose()
    }
  })
})

describe('runtime screen readiness publication', () => {
  it.each([
    ['claude-bypass-dialog', false],
    ['claude-bypass-paste-exit', false],
    ['claude-bypass-to-composer', true]
  ] as const)('publishes cursor evidence for %s', async (name, expected) => {
    const data = readFileSync(join(__dirname, '__fixtures__', `${name}.txt`), 'utf8')
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'Claude Code',
      foregroundProcess: 'claude',
      data,
      size: { cols: 100, rows: 32 }
    })
    try {
      const screen = await runtime.readTerminal(handle, { screen: true })
      expect(screen.source).toBe('screen')
      expect(screen.composerReady).toBe(expected)
    } finally {
      runtime.onPtyExit('pty-1', 0)
    }
  })
})
