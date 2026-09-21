import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from './session-subprocess-handle'
import { TerminalHost, type TerminalHostOptions } from './terminal-host'

const { opendirSyncMock } = vi.hoisted(() => ({ opendirSyncMock: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  opendirSync: opendirSyncMock
}))

vi.mock('../pty-descendant-termination', () => ({ killWithDescendantSweep: vi.fn() }))

const closeSync = vi.fn()

function dirReading(readSync: () => unknown): { readSync: () => unknown; closeSync: () => void } {
  return { readSync, closeSync }
}

function failWith(code: string): never {
  throw Object.assign(new Error(code), { code })
}

function createMockSubprocess(): SubprocessHandle {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 99999,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      setTimeout(() => onExitCb?.(0), 5)
    }),
    terminateOwnedTree: () => 'unavailable' as const,
    forceKill: vi.fn(() => onExitCb?.(137)),
    signal: vi.fn(),
    onData() {},
    onExit(cb) {
      onExitCb = cb
    },
    dispose: vi.fn()
  }
}

// #17696: only the daemon process can say whether TCC lets it enumerate the cwd, so its verdict
// rides on the create result. A non-permission failure must never read as denial.
describe('TerminalHost cwd readability verdict', () => {
  let host: TerminalHost
  let platformDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    closeSync.mockReset()
    opendirSyncMock.mockReset().mockReturnValue(dirReading(() => ({ name: 'entry' })))
    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    const spawnSubprocess: TerminalHostOptions['spawnSubprocess'] = () => createMockSubprocess()
    host = new TerminalHost({ spawnSubprocess })
  })

  afterEach(async () => {
    await host.dispose()
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  const create = (sessionId: string, cwd?: string) =>
    host.createOrAttach({
      sessionId,
      cols: 80,
      rows: 24,
      ...(cwd ? { cwd } : {}),
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })

  it('reports an enumerable cwd as readable, and closes the handle', async () => {
    expect((await create('readable', '/work/repo')).cwdReadableByDaemon).toBe(true)
    expect(opendirSyncMock).toHaveBeenCalledWith('/work/repo')
    expect(closeSync).toHaveBeenCalled()
  })

  it('reports an empty directory as readable', async () => {
    opendirSyncMock.mockReturnValue(dirReading(() => null))
    expect((await create('empty', '/work/empty')).cwdReadableByDaemon).toBe(true)
  })

  // The #17696 shape: TCC refuses the daemon, and only a refusal may read as denial.
  it('reports EPERM on open as denied', async () => {
    opendirSyncMock.mockImplementation(() => failWith('EPERM'))
    expect((await create('eperm', '/Users/alice/Documents/repo')).cwdReadableByDaemon).toBe(false)
  })

  it('reports EACCES on the first read as denied, and still closes the handle', async () => {
    opendirSyncMock.mockReturnValue(dirReading(() => failWith('EACCES')))
    expect((await create('eacces', '/Users/alice/Desktop/repo')).cwdReadableByDaemon).toBe(false)
    expect(closeSync).toHaveBeenCalled()
  })

  it('reports a missing cwd as readable — absence is not a permission denial', async () => {
    opendirSyncMock.mockImplementation(() => failWith('ENOENT'))
    expect((await create('enoent', '/definitely/not/a/real/dir')).cwdReadableByDaemon).toBe(true)
  })

  it('reports a non-directory cwd as readable', async () => {
    opendirSyncMock.mockImplementation(() => failWith('ENOTDIR'))
    expect((await create('enotdir', '/work/repo/file.txt')).cwdReadableByDaemon).toBe(true)
  })

  it('reports an unexpected failure as readable — it must not masquerade as denial', async () => {
    opendirSyncMock.mockImplementation(() => {
      throw new TypeError('opendir is not a function')
    })
    expect((await create('unexpected', '/work/repo')).cwdReadableByDaemon).toBe(true)
  })

  it('omits the verdict when no cwd was requested', async () => {
    expect((await create('no-cwd')).cwdReadableByDaemon).toBeUndefined()
    expect(opendirSyncMock).not.toHaveBeenCalled()
  })

  it('omits the verdict on attach to an existing session', async () => {
    await create('attach', '/work/repo')
    const attached = await create('attach', '/work/repo')
    expect(attached.isNew).toBe(false)
    expect(attached.cwdReadableByDaemon).toBeUndefined()
  })
})
