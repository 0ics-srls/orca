import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AiVaultScannerServiceClient } from '../../../src/main/ai-vault/session-scanner-service-client'
import {
  AiVaultServiceTestChild,
  readyAiVaultServiceChild
} from '../../../src/main/ai-vault/session-scanner-service-test-child'

const observations = []

function fixture() {
  const child = new AiVaultServiceTestChild()
  const client = new AiVaultScannerServiceClient({
    processFactory: () => child.asChildProcess(),
    init: () => ({ sessionParseCache: null, sessionSearch: null })
  })
  return { child, client }
}

afterEach(() => vi.useRealTimers())
afterAll(() =>
  writeFileSync(
    process.env.ORCA_SCANNER_CUSTODY_OUTPUT ??
      resolve('docs/audits/scanner-shutdown-custody/results.json'),
    `${JSON.stringify({ runtime: process.versions, observations }, null, 2)}\n`
  )
)

it('explicit disposal returns before physical child exit', async () => {
  vi.useFakeTimers()
  const { child, client } = fixture()
  const call = client.request({ type: 'request', operation: 'titles', requests: [] })
  const rejection = expect(call).rejects.toThrow('disposed')
  readyAiVaultServiceChild(child)
  await Promise.resolve()
  const returned = client.dispose()
  await rejection
  expect(returned).toBeUndefined()
  expect(child.sent).toContainEqual({ type: 'shutdown' })
  expect(child.killed).toBe(false)
  expect(child.listenerCount('exit')).toBe(1)
  await vi.advanceTimersByTimeAsync(1_999)
  expect(child.killed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(child.killed).toBe(true)
  observations.push({
    case: 'dispose-does-not-join',
    returned: 'undefined',
    killAfterMs: 2_000,
    physicalExitEmitted: false,
    remainingExitListeners: child.listenerCount('exit')
  })
  child.emit('exit', 0)
  expect(child.listenerCount('exit')).toBe(0)
})

it('a graceful physical exit clears the escalation timer', async () => {
  vi.useFakeTimers()
  const { child, client } = fixture()
  const call = client.request({ type: 'request', operation: 'titles', requests: [] })
  const rejection = expect(call).rejects.toThrow('disposed')
  readyAiVaultServiceChild(child)
  await Promise.resolve()
  client.dispose()
  child.emit('exit', 0)
  await rejection
  await vi.advanceTimersByTimeAsync(60_000)
  expect(child.killed).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  observations.push({ case: 'graceful-exit', killed: false, remainingTimers: 0 })
})

it('a pre-ready invalidation remains pending after disposal and its original timeout', async () => {
  vi.useFakeTimers()
  const { child, client } = fixture()
  let outcome = 'pending'
  void client.invalidate(['/controlled/transcript.jsonl']).then(
    () => {
      outcome = 'fulfilled'
    },
    () => {
      outcome = 'rejected'
    }
  )
  client.dispose()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(outcome).toBe('pending')
  expect(child.killed).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  observations.push({
    case: 'pre-ready-invalidation',
    outcomeAfterMs: 60_000,
    outcome,
    remainingTimers: 0
  })
  child.emit('exit', 0)
})

it('ready then immediate disposal permits a late invalidation with no acknowledgement owner', async () => {
  vi.useFakeTimers()
  const { child, client } = fixture()
  let outcome = 'pending'
  void client.invalidate(['/controlled/transcript.jsonl']).then(
    () => {
      outcome = 'fulfilled'
    },
    () => {
      outcome = 'rejected'
    }
  )
  readyAiVaultServiceChild(child)
  client.dispose()
  await vi.advanceTimersByTimeAsync(60_000)
  const types = child.sent.map((message) => message.type)
  expect(types).toEqual(['init', 'shutdown', 'invalidate'])
  expect(child.listenerCount('message')).toBe(0)
  expect(outcome).toBe('pending')
  observations.push({
    case: 'ready-dispose-continuation',
    messages: types,
    outcome,
    outcomeAfterMs: 60_000,
    messageListeners: 0
  })
  child.emit('exit', 0)
})
