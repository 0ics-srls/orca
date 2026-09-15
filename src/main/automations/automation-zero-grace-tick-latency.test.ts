import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Repo } from '../../shared/repo-types'
import { AutomationService } from './service'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

async function createStore() {
  vi.resetModules()
  installFakeAppEnvironment({ getPath: () => testState.dir })
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  return new Store()
}

const makeRepo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  path: '/repo',
  displayName: 'test',
  badgeColor: '#fff',
  addedAt: 1,
  ...overrides
})

describe('AutomationService zero-grace tick latency', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-automations-test-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  const makeDaily = (store) =>
    store.createAutomation({
      name: 'Zero grace',
      prompt: 'Run it',
      agentId: 'claude',
      projectId: 'r1',
      workspaceMode: 'existing',
      workspaceId: 'wt1',
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstart: new Date('2026-05-12T00:00:00').getTime(),
      missedRunGraceMinutes: 0
    })

  const runService = async (store, { startAt, evaluateAt }) => {
    vi.setSystemTime(startAt)
    const send = vi.fn()
    const service = new AutomationService(store, { tickMs: 60_000 })
    service.setWebContents({ isDestroyed: () => false, send } as never)
    service.start()
    service.setRendererReady()
    vi.setSystemTime(evaluateAt)
    await vi.advanceTimersByTimeAsync(60_000)
    service.stop()
    return send
  }

  // Why 1ms and 45s: the tick interval is never aligned to an occurrence, so ANY positive
  // lateness used to exceed a zero grace budget and skip the run (#11299).
  it.each([
    ['1ms late', 1],
    ['45s late', 45_000]
  ])(
    'dispatches a zero-grace occurrence that came due while running (%s)',
    async (_label, lateMs) => {
      vi.setSystemTime(new Date('2026-05-13T08:00:00'))
      const store = await createStore()
      store.addRepo(makeRepo())
      const automation = makeDaily(store)

      const due = new Date('2026-05-13T09:00:00').getTime()
      await runService(store, {
        startAt: new Date('2026-05-13T08:59:00'),
        evaluateAt: new Date(due + lateMs)
      })

      const runs = store.listAutomationRuns(automation.id)
      expect(runs[0]?.status).not.toBe('skipped_missed')
      expect(runs[0]?.scheduledFor).toBe(due)
    }
  )

  // The other half of the invariant: grace still governs an occurrence that came due while the
  // scheduler was NOT running, so downtime catch-up policy is unchanged.
  it('still skips a zero-grace occurrence that came due while stopped', async () => {
    vi.setSystemTime(new Date('2026-05-13T08:00:00'))
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = makeDaily(store)

    const due = new Date('2026-05-13T09:00:00').getTime()
    // Start AFTER the occurrence: it came due during downtime, which is what grace is for.
    await runService(store, {
      startAt: new Date(due + 60_000),
      evaluateAt: new Date(due + 120_000)
    })

    const runs = store.listAutomationRuns(automation.id)
    expect(runs[0]?.status).toBe('skipped_missed')
  })
})
