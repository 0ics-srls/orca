import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  resetClaudeKeychainMocks,
  restorePlatform,
  setPlatform
} from './claude-account-service-test-harness'

const CLAUDE_SERVICE_TEST_ROOT = join(tmpdir(), 'orca-claude-service-supersede-test')

vi.mock('electron', () => ({
  app: {
    getPath: () => CLAUDE_SERVICE_TEST_ROOT
  }
}))

const commandMocks = vi.hoisted(() => ({
  resolveClaudeCommand: vi.fn(() => 'claude')
}))

vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: commandMocks.resolveClaudeCommand
}))

vi.mock('./keychain', () => ({
  deleteActiveClaudeKeychainCredentialsStrict: vi.fn(async () => {}),
  deleteManagedClaudeKeychainCredentials: vi.fn(async () => {}),
  readActiveClaudeKeychainCredentials: vi.fn(),
  readActiveClaudeKeychainCredentialsStrict: vi.fn(),
  readManagedClaudeKeychainCredentials: vi.fn(),
  writeActiveClaudeKeychainCredentials: vi.fn(async () => {}),
  writeManagedClaudeKeychainCredentials: vi.fn(async () => {})
}))

type StubLoginChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: () => boolean
}

// No pid: the POSIX teardown signals -pid as a process group, which must never
// reach a real group from a test double.
function createStubLoginChild(): StubLoginChild {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  })
}

/** A service whose `claude auth login` never finishes on its own. */
async function createServiceWithHangingLogin(): Promise<{
  service: { addAccount: (target?: { runtime?: 'host' }) => Promise<unknown> }
  children: StubLoginChild[]
}> {
  vi.resetModules()
  const children: StubLoginChild[] = []
  vi.doMock('node:child_process', () => ({
    spawn: vi.fn(() => {
      const child = createStubLoginChild()
      children.push(child)
      return child
    })
  }))
  let settings = {
    claudeManagedAccounts: [],
    activeClaudeManagedAccountId: null,
    activeClaudeManagedAccountIdsByRuntime: { host: null, wsl: {} }
  }
  const store = {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn((updates: Partial<typeof settings>) => {
      settings = { ...settings, ...updates }
      return settings
    })
  }
  const runtimeAuth = {
    clearLastWrittenCredentialsJson: vi.fn(),
    syncForCurrentSelection: vi.fn(async () => {}),
    forceMaterializeCurrentSelectionForRollback: vi.fn(async () => {})
  }
  const rateLimits = {
    evictInactiveClaudeCache: vi.fn(),
    refreshForClaudeAccountChange: vi.fn(async () => ({ accounts: [], activeAccountId: null }))
  }
  const { ClaudeAccountService } = await import('./service')
  const service = new ClaudeAccountService(
    store as never,
    rateLimits as never,
    runtimeAuth as never
  )
  return { service, children }
}

describe('ClaudeAccountService abandoned login', () => {
  beforeEach(() => {
    // Why: the darwin path adds Keychain round-trips this test has no stake in.
    setPlatform('linux')
    resetClaudeKeychainMocks()
  })

  afterEach(() => {
    restorePlatform()
    vi.doUnmock('node:child_process')
    rmSync(CLAUDE_SERVICE_TEST_ROOT, { recursive: true, force: true })
  })

  it('supersedes the login a closed Settings pane abandoned instead of queueing behind it', async () => {
    const { service, children } = await createServiceWithHangingLogin()
    const abandoned = service.addAccount({ runtime: 'host' })
    const abandonedRejection = expect(abandoned).rejects.toThrow('Claude sign-in was cancelled.')
    await vi.waitUntil(() => children.length === 1)

    // The user reopens Settings and clicks Add Account again.
    const retry = service.addAccount({ runtime: 'host' })
    const retryRejection = expect(retry).rejects.toThrow()

    await abandonedRejection
    expect(children[0].kill).toHaveBeenCalled()
    // Why: the point of the fix — the second login starts now, not after the
    // abandoned one's whole sign-in deadline elapses.
    await vi.waitUntil(() => children.length === 2)

    children[1].emit('close', 1)
    await retryRejection
  })
})
