import { describe, expect, it } from 'vitest'
import { _gitOperationLockWaiterCountForTests, runWithGitOperationLock } from './git-operation-lock'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function holdLock(key: string): Promise<{ release: () => Promise<void> }> {
  const started = deferred()
  const gate = deferred()
  const held = runWithGitOperationLock(key, undefined, async () => {
    started.resolve()
    await gate.promise
  })
  await started.promise
  return {
    release: async () => {
      gate.resolve()
      await held
    }
  }
}

describe('runWithGitOperationLock', () => {
  it('runs equal-priority waiters in arrival order', async () => {
    const key = 'fifo'
    const holder = await holdLock(key)
    const order: string[] = []
    const runs = ['a', 'b', 'c'].map((name) =>
      runWithGitOperationLock(key, undefined, async () => {
        order.push(name)
      })
    )
    expect(_gitOperationLockWaiterCountForTests(key)).toBe(3)
    await holder.release()
    await Promise.all(runs)
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('grants a higher-priority waiter before earlier lower-priority ones', async () => {
    const key = 'priority'
    const holder = await holdLock(key)
    const order: string[] = []
    const run = (name: string, priority: number): Promise<void> =>
      runWithGitOperationLock(
        key,
        undefined,
        async () => {
          order.push(name)
        },
        { priority }
      )
    const runs = [run('rearm-1', 1), run('rearm-2', 1), run('create', 2), run('cleanup', 0)]
    await holder.release()
    await Promise.all(runs)
    expect(order).toEqual(['create', 'rearm-1', 'rearm-2', 'cleanup'])
  })

  it('frees an aborted waiter slot so later waiters still run', async () => {
    const key = 'abort'
    const holder = await holdLock(key)
    const controller = new AbortController()
    const order: string[] = []
    const aborted = runWithGitOperationLock(key, controller.signal, async () => {
      order.push('aborted')
    })
    const next = runWithGitOperationLock(key, undefined, async () => {
      order.push('next')
    })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    expect(_gitOperationLockWaiterCountForTests(key)).toBe(1)
    await holder.release()
    await next
    expect(order).toEqual(['next'])
  })

  it('rejects an already-aborted caller without queueing it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runWithGitOperationLock('pre-aborted', controller.signal, async () => 'ran')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await runWithGitOperationLock('pre-aborted', undefined, async () => 'ran')).toBe('ran')
  })

  it('releases the lock when the holder throws', async () => {
    const key = 'throws'
    await expect(
      runWithGitOperationLock(key, undefined, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(await runWithGitOperationLock(key, undefined, async () => 'after')).toBe('after')
  })
})
