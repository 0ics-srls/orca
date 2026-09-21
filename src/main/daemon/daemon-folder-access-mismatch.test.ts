import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validate } from '../telemetry/validator'

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))
vi.mock('../telemetry/client', () => ({ track: trackMock }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  homedir: () => '/Users/alice'
}))

import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import {
  clearDaemonFolderAccessMismatch,
  getDaemonFolderAccessMismatch,
  recordDaemonFolderAccessMismatch,
  resetDaemonFolderAccessMismatchForTests
} from './daemon-folder-access-mismatch'

const DAEMON: DaemonEndpointIdentity = { pid: 1530, startedAtMs: 1_700_000, launchNonce: 'n1' }
const RESTARTED: DaemonEndpointIdentity = { pid: 1610, startedAtMs: 1_700_900, launchNonce: 'n2' }
const DOCUMENTS = '/Users/alice/Documents/repo'

beforeEach(() => {
  resetDaemonFolderAccessMismatchForTests()
  trackMock.mockReset()
})

describe('daemon folder access mismatch evidence', () => {
  it('has nothing until a spawn records one', () => {
    expect(getDaemonFolderAccessMismatch(DAEMON)).toBeNull()
  })

  it('classifies the recorded cwd and keeps only the latest entry', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(DAEMON)?.cwdClass).toBe('documents')

    recordDaemonFolderAccessMismatch(DAEMON, '/Users/alice/Desktop/other')
    expect(getDaemonFolderAccessMismatch(DAEMON)?.cwdClass).toBe('desktop')
  })

  it('clears when the same daemon later reads a cwd successfully', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    clearDaemonFolderAccessMismatch(DAEMON)
    expect(getDaemonFolderAccessMismatch(DAEMON)).toBeNull()
  })

  it('ignores a clear from a different daemon', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    clearDaemonFolderAccessMismatch(RESTARTED)
    expect(getDaemonFolderAccessMismatch(DAEMON)).not.toBeNull()
  })

  // This is the whole restart remedy: a new daemon has a new identity, so the poll goes quiet
  // without anyone probing the folder again.
  it('returns null once the daemon that earned it has been replaced', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(RESTARTED)).toBeNull()
  })

  it('returns null when there is no current daemon identity', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(null)).toBeNull()
  })

  it('records nothing for a daemon that has no identity yet', () => {
    recordDaemonFolderAccessMismatch(null, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(DAEMON)).toBeNull()
  })

  it('gives one daemon a stable scope and two daemons different scopes', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    const first = getDaemonFolderAccessMismatch(DAEMON)?.daemonScope
    expect(getDaemonFolderAccessMismatch(DAEMON)?.daemonScope).toBe(first)

    recordDaemonFolderAccessMismatch(RESTARTED, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(RESTARTED)?.daemonScope).not.toBe(first)
  })

  it('keeps every path fragment out of the scope', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    const scope = getDaemonFolderAccessMismatch(DAEMON)?.daemonScope ?? ''
    expect(scope).toMatch(/^[0-9a-f]{16}$/)
    for (const fragment of ['alice', 'Documents', 'repo', 'Users']) {
      expect(scope).not.toContain(fragment)
    }
  })
})

describe('daemon_folder_access_notice shown', () => {
  it('emits a validator-accepted payload once per scope that leaves main', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    getDaemonFolderAccessMismatch(DAEMON)
    getDaemonFolderAccessMismatch(DAEMON)

    expect(trackMock).toHaveBeenCalledTimes(1)
    const [name, props] = trackMock.mock.calls[0]
    expect(name).toBe('daemon_folder_access_notice')
    expect(props).toEqual({ action: 'shown', cwd_class: 'documents' })
    expect(validate('daemon_folder_access_notice', props).ok).toBe(true)
  })

  it('does not emit while the evidence is withheld', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    getDaemonFolderAccessMismatch(RESTARTED)
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('emits again for a replacement daemon that is denied too', () => {
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    getDaemonFolderAccessMismatch(DAEMON)
    recordDaemonFolderAccessMismatch(RESTARTED, DOCUMENTS)
    getDaemonFolderAccessMismatch(RESTARTED)
    expect(trackMock).toHaveBeenCalledTimes(2)
  })

  it('still hands out the notice when the telemetry client throws', () => {
    trackMock.mockImplementationOnce(() => {
      throw new Error('posthog exploded')
    })
    recordDaemonFolderAccessMismatch(DAEMON, DOCUMENTS)
    expect(getDaemonFolderAccessMismatch(DAEMON)?.cwdClass).toBe('documents')
  })
})
