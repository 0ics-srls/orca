import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true)
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  existsSync: existsSyncMock
}))

import {
  classifyCodesignDisplayOutput,
  getDaemonMacCodeIdentity,
  resetDaemonMacCodeIdentityForTests
} from './daemon-mac-code-identity'

const HELPER_PATH =
  '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper'
const PARKED_PATH =
  '/private/var/folders/x/T/com.stablyai.orca.ShipIt.abc/Orca.app/Contents/MacOS/Orca'

function runnerReturning(stderr: string, code: number | null) {
  return vi.fn(async () => ({ code, stdout: '', stderr }))
}

beforeEach(() => {
  resetDaemonMacCodeIdentityForTests()
  existsSyncMock.mockReset().mockReturnValue(true)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('classifyCodesignDisplayOutput', () => {
  it('resolves the executable path codesign reports for a live process', () => {
    expect(
      classifyCodesignDisplayOutput(
        `Executable=${HELPER_PATH}\nIdentifier=com.stablyai.orca.helper\nFormat=pid diskrep\n`,
        0
      )
    ).toBe('resolved')
  })

  it('separates the Squirrel staging copy from the installed bundle', () => {
    expect(classifyCodesignDisplayOutput(`Executable=${PARKED_PATH}\n`, 0)).toBe('parked')
    expect(
      classifyCodesignDisplayOutput(
        'Executable=/Users/a/Library/Caches/com.stablyai.orca.ShipIt/u/Orca.app/Contents/MacOS/Orca\n',
        0
      )
    ).toBe('parked')
  })

  it('treats the unlinked-executable diagnostic as unresolvable', () => {
    expect(classifyCodesignDisplayOutput('+3337: No such file or directory\n', 1)).toBe(
      'unresolvable'
    )
  })

  // The displayed path can be deleted between codesign reading it and this check; same verdict.
  it('treats a displayed path that is already gone as unresolvable', () => {
    existsSyncMock.mockReturnValue(false)
    expect(classifyCodesignDisplayOutput(`Executable=${HELPER_PATH}\n`, 0)).toBe('unresolvable')
  })

  it('fails open on a dead pid, an exiting pid, unsigned code, or an unexpected failure', () => {
    expect(classifyCodesignDisplayOutput('+999999: No such process\n', 1)).toBe('probe-failed')
    // errSecCSNoSuchCode: proc_pidpath resolved, the pid is just on its way out.
    expect(
      classifyCodesignDisplayOutput('+3337: host has no guest with the requested attributes\n', 1)
    ).toBe('probe-failed')
    expect(classifyCodesignDisplayOutput('/opt/tool: code object is not signed at all\n', 1)).toBe(
      'probe-failed'
    )
    expect(classifyCodesignDisplayOutput('', null)).toBe('probe-failed')
  })

  it('does not read an unlinked diagnostic out of a successful display', () => {
    expect(
      classifyCodesignDisplayOutput(`Executable=${HELPER_PATH}\nNo such file or directory\n`, 0)
    ).toBe('resolved')
  })
})

describe('getDaemonMacCodeIdentity', () => {
  it('asks codesign to display the running pid and reads its stderr', async () => {
    const runCommand = runnerReturning(`Executable=${HELPER_PATH}\n`, 0)
    await expect(getDaemonMacCodeIdentity(3337, runCommand)).resolves.toBe('resolved')
    expect(runCommand).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      ['--display', '--verbose=1', '+3337'],
      expect.any(Number)
    )
  })

  it('reports unresolvable when codesign cannot map the pid to on-disk code', async () => {
    await expect(
      getDaemonMacCodeIdentity(3337, runnerReturning('+3337: No such file or directory\n', 1))
    ).resolves.toBe('unresolvable')
  })

  // One probe per daemon generation: both adoption events ask, and a denial can ask repeatedly.
  it('probes once per pid and reprobes when the daemon generation changes', async () => {
    const runCommand = runnerReturning(`Executable=${HELPER_PATH}\n`, 0)
    await getDaemonMacCodeIdentity(3337, runCommand)
    await getDaemonMacCodeIdentity(3337, runCommand)
    expect(runCommand).toHaveBeenCalledTimes(1)
    await getDaemonMacCodeIdentity(4001, runCommand)
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('fails open when codesign cannot be spawned, off macOS, or without a pid', async () => {
    await expect(
      getDaemonMacCodeIdentity(3337, async () => {
        throw new Error('spawn ENOENT')
      })
    ).resolves.toBe('probe-failed')

    const runCommand = vi.fn()
    await expect(getDaemonMacCodeIdentity(0, runCommand)).resolves.toBe('probe-failed')
    await expect(getDaemonMacCodeIdentity(null, runCommand)).resolves.toBe('probe-failed')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(getDaemonMacCodeIdentity(3337, runCommand)).resolves.toBe('probe-failed')
    expect(runCommand).not.toHaveBeenCalled()
  })
})
