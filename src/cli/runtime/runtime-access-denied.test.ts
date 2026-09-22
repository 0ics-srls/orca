import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { formatCliError, reportCliError } from '../cli-error'
import { RuntimeClient } from './client'
import { launchOrcaApp } from './launch'
import { getCliStatus } from './status'
import { sendRequest } from './transport'
import { RuntimeRpcFailureError } from './types'

const { connect, tryReadMetadata } = vi.hoisted(() => ({
  connect: vi.fn(),
  tryReadMetadata: vi.fn()
}))
vi.mock('node:net', () => ({ createConnection: connect }))
vi.mock('./metadata', () => ({ tryReadMetadata, readMetadata: tryReadMetadata }))
vi.mock('./launch', () => ({ launchOrcaApp: vi.fn() }))
vi.mock('./runtime-remote-pairing', () => ({ resolveRemotePairing: () => null }))

const metadata: RuntimeMetadata = {
  runtimeId: 'runtime-test',
  pid: 12345,
  transports: [{ kind: 'unix', endpoint: '/private-runtime.sock' }],
  authToken: 'private-runtime-token',
  startedAt: 1
}

class TestSocket extends EventEmitter {
  setEncoding = vi.fn()
  end = vi.fn()
  destroy = vi.fn()
  write = vi.fn()
}

const RESTART_OR_ABSENT_ADVICE =
  /Restart Orca and try again|Orca is not running|Run 'orca open' first/

let socket: TestSocket

beforeEach(() => {
  vi.stubEnv('CODEX_SANDBOX', '')
  socket = new TestSocket()
  connect.mockReturnValue(socket)
  tryReadMetadata.mockReturnValue(metadata)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Node emits 'error' then 'close' for a refused or denied connect.
function failConnect(code: string): void {
  socket.emit('error', Object.assign(new Error(`connect ${code} /private-runtime.sock`), { code }))
  socket.emit('close')
}

function mockKill(code?: string): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'kill').mockImplementation(() => {
    if (code) {
      throw Object.assign(new Error(`kill ${code}`), { code })
    }
    return true
  })
}

describe('runtime access denied', () => {
  it.each(['EPERM', 'EACCES'])('classifies a %s connect without restart advice', async (code) => {
    const pending = sendRequest(metadata, 'status.get', undefined, 1000)
    failConnect(code)
    const error = await pending.catch((failure: unknown) => failure)

    expect(error).toMatchObject({
      code: 'runtime_access_denied',
      data: {
        operation: 'connect',
        systemCode: code,
        processState: 'unverifiable',
        retryable: false,
        pid: metadata.pid
      }
    })
    expect(socket.write).not.toHaveBeenCalled()
    const human = formatCliError(error)
    expect(human).toContain(`connecting to the Orca runtime (${code})`)
    expect(human).toContain("Next step: Do not restart Orca or run 'orca open'")
    expect(human).not.toMatch(RESTART_OR_ABSENT_ADVICE)
    expect(human).not.toContain('private-runtime')
  })

  it('names the Codex sandbox only when CODEX_SANDBOX is set', async () => {
    vi.stubEnv('CODEX_SANDBOX', 'seatbelt')
    const pending = sendRequest(metadata, 'status.get', undefined, 1000)
    failConnect('EPERM')
    const error = await pending.catch((failure: unknown) => failure)

    expect(error).toMatchObject({
      code: 'runtime_access_denied',
      data: { codexSandbox: 'seatbelt' }
    })
    const human = formatCliError(error)
    expect(human).toContain('The Codex sandbox denied this command access')
    expect(human).toContain('escalated permissions, outside the Codex sandbox')
    expect(human).not.toMatch(RESTART_OR_ABSENT_ADVICE)
  })

  it('gives the generic permission message outside a Codex sandbox', async () => {
    const pending = sendRequest(metadata, 'status.get', undefined, 1000)
    failConnect('EACCES')
    const error = await pending.catch((failure: unknown) => failure)

    expect(error).not.toHaveProperty('data.codexSandbox')
    expect(formatCliError(error)).toContain(
      "Permission denied while connecting to the Orca runtime (EACCES). This command's sandbox or OS permissions block access"
    )
    expect(formatCliError(error)).not.toContain('Codex')
  })

  it('keeps ordinary connect failures as runtime_unavailable', async () => {
    const pending = sendRequest(metadata, 'status.get', undefined, 1000)
    failConnect('ECONNREFUSED')
    await expect(pending).rejects.toMatchObject({ code: 'runtime_unavailable' })
  })

  it.each(['EPERM', 'EACCES'])(
    'fails status on a %s connect instead of guessing a state',
    async (code) => {
      const kill = mockKill('ESRCH')
      const pending = getCliStatus('/test')
      failConnect(code)

      await expect(pending).rejects.toMatchObject({
        code: 'runtime_access_denied',
        data: { operation: 'connect', systemCode: code }
      })
      expect(kill).not.toHaveBeenCalled()
    }
  )

  // Why: a refused or missing socket proves the caller reached the endpoint, so a later EPERM
  // pid probe is another uid (#20098), not a sandbox; "don't restart" would be wrong advice.
  it.each(['ECONNREFUSED', 'ENOENT'])(
    'keeps starting for %s plus an EPERM pid probe',
    async (code) => {
      mockKill('EPERM')
      const pending = getCliStatus('/test')
      failConnect(code)

      await expect(pending).resolves.toMatchObject({
        result: { app: { running: true, pid: metadata.pid }, runtime: { state: 'starting' } }
      })
    }
  )

  it.each(['ENOENT', 'ECONNREFUSED'])('keeps stale_bootstrap for %s plus ESRCH', async (code) => {
    mockKill('ESRCH')
    const pending = getCliStatus('/test')
    failConnect(code)

    await expect(pending).resolves.toMatchObject({
      result: {
        app: { running: false, pid: null },
        runtime: { state: 'stale_bootstrap', reachable: false }
      }
    })
  })

  it('keeps starting for a refused connect with a live pid', async () => {
    mockKill()
    const pending = getCliStatus('/test')
    failConnect('ECONNREFUSED')

    await expect(pending).resolves.toMatchObject({
      result: { app: { running: true }, runtime: { state: 'starting' } }
    })
  })

  it('does not launch or poll Orca when the initial status is denied', async () => {
    const pending = new RuntimeClient('/test', 1000, null, null).openOrca()
    failConnect('EPERM')

    await expect(pending).rejects.toMatchObject({ code: 'runtime_access_denied' })
    expect(launchOrcaApp).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('reports status --json as an ok:false envelope with the recovery data', async () => {
    const pending = getCliStatus('/test')
    failConnect('EPERM')
    const error = await pending.catch((failure: unknown) => failure)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    reportCliError(error, true, { commandPath: ['status'] })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      error: {
        code: 'runtime_access_denied',
        data: {
          operation: 'connect',
          systemCode: 'EPERM',
          retryable: false,
          nextSteps: expect.any(Array)
        }
      }
    })
  })

  it('adds no local restart advice to a host-reported denial', () => {
    const error = new RuntimeRpcFailureError({
      id: 'request',
      ok: false,
      error: {
        code: 'runtime_access_denied',
        message: 'Permission denied while connecting to the Orca runtime (EPERM).'
      },
      _meta: { runtimeId: 'runtime-test' }
    })

    expect(formatCliError(error)).toBe(
      'Permission denied while connecting to the Orca runtime (EPERM).'
    )
  })
})
