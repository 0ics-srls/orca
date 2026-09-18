import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  createRateLimits,
  createRuntimeHome,
  createSettings,
  createStore,
  registerCodexAccountsTestHomes,
  testState
} from './service-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the harness doubles implement every member the add-account login path reaches; this test drives the service only through addAccount, cancelPendingLogin and the login URL subscription.
const asServiceDouble = <T>(double: unknown): T => double as T

type StubLoginChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: () => boolean
  exitCode: number | null
  signalCode: string | null
}

function createStubLoginChild(): StubLoginChild {
  const child: StubLoginChild = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => true
  })
  // The real codex CLI forwards SIGTERM to its native child and exits.
  child.kill = vi.fn(() => {
    child.exitCode = 143
    return true
  })
  return child
}

/** A service whose `codex login` never finishes on its own. */
async function createServiceWithHangingLogin(): Promise<{
  service: {
    addAccount: () => Promise<unknown>
    cancelPendingLogin: () => boolean
  }
  children: StubLoginChild[]
}> {
  vi.resetModules()
  const children: StubLoginChild[] = []
  vi.doMock('node:child_process', () => ({
    execFileSync: vi.fn(),
    spawn: vi.fn(() => {
      const child = createStubLoginChild()
      children.push(child)
      return child
    })
  }))
  vi.doMock('../codex-cli/command', () => ({
    resolveCodexCommand: () => 'codex'
  }))
  const { CodexAccountService } = await import('./service')
  const service = new CodexAccountService(
    asServiceDouble(createStore(createSettings())),
    asServiceDouble(createRateLimits()),
    asServiceDouble(createRuntimeHome())
  )
  return { service, children }
}

describe('CodexAccountService abandoned login', () => {
  registerCodexAccountsTestHomes()

  it('supersedes the login a closed Settings pane abandoned instead of queueing behind it', async () => {
    const { service, children } = await createServiceWithHangingLogin()
    try {
      const abandoned = service.addAccount()
      const abandonedRejection = expect(abandoned).rejects.toThrow('Codex sign-in was cancelled.')
      await vi.waitUntil(() => children.length === 1)

      // The user reopens Settings and clicks Add Account again.
      const retry = service.addAccount()
      const retryRejection = expect(retry).rejects.toThrow()

      await abandonedRejection
      expect(children[0].kill).toHaveBeenCalledTimes(1)
      // Why: the point of the fix — the second login starts now, not after the
      // abandoned one's whole sign-in deadline elapses.
      await vi.waitUntil(() => children.length === 2)
      expect(children[1].kill).not.toHaveBeenCalled()

      service.cancelPendingLogin()
      await retryRejection
    } finally {
      vi.doUnmock('node:child_process')
      vi.doUnmock('../codex-cli/command')
    }
  })

  it('reports whether a pending login was there to cancel', async () => {
    const { service, children } = await createServiceWithHangingLogin()
    try {
      const pending = service.addAccount()
      const rejection = expect(pending).rejects.toThrow('Codex sign-in was cancelled.')
      await vi.waitUntil(() => children.length === 1)

      expect(service.cancelPendingLogin()).toBe(true)
      await rejection
      expect(service.cancelPendingLogin()).toBe(false)
    } finally {
      vi.doUnmock('node:child_process')
      vi.doUnmock('../codex-cli/command')
    }
  })

  it('publishes the sign-in link codex prints and drops it when the login ends', async () => {
    vi.resetModules()
    const children: StubLoginChild[] = []
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(),
      spawn: vi.fn(() => {
        const child = createStubLoginChild()
        children.push(child)
        return child
      })
    }))
    vi.doMock('../codex-cli/command', () => ({
      resolveCodexCommand: () => 'codex'
    }))
    try {
      const { CodexAccountService } = await import('./service')
      const service = new CodexAccountService(
        asServiceDouble(createStore(createSettings())),
        asServiceDouble(createRateLimits()),
        asServiceDouble(createRuntimeHome())
      )
      const published: (string | null)[] = []
      service.subscribePendingLoginUrl((url) => published.push(url))

      const pending = service.addAccount()
      const rejection = expect(pending).rejects.toThrow('Codex sign-in was cancelled.')
      await vi.waitUntil(() => children.length === 1)

      const authUrl = 'https://auth.openai.com/oauth/authorize?client_id=orca&state=abc'
      children[0].stdout.write(
        `Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\n${authUrl}\n`
      )
      await vi.waitUntil(() => service.getPendingLoginUrl() === authUrl)
      expect(published).toEqual([authUrl])

      service.cancelPendingLogin()
      await rejection
      // Why: the link dies with the login server it points back at.
      expect(service.getPendingLoginUrl()).toBeNull()
      expect(published).toEqual([authUrl, null])
    } finally {
      vi.doUnmock('node:child_process')
      vi.doUnmock('../codex-cli/command')
    }
  })
})
