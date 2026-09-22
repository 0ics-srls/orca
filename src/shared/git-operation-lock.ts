type GitOperationWaiter = {
  readonly priority: number
  readonly grant: () => void
}

type GitOperationLane = {
  waiters: GitOperationWaiter[]
}

// A lane exists exactly while its lock is held; queued waiters are handed the lock directly.
const lanes = new Map<string, GitOperationLane>()

export type GitOperationLockOptions = {
  /** Higher runs first among queued waiters; equal priorities keep arrival order. */
  readonly priority?: number
}

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function enqueue(lane: GitOperationLane, waiter: GitOperationWaiter): void {
  const index = lane.waiters.findIndex((queued) => queued.priority < waiter.priority)
  if (index === -1) {
    lane.waiters.push(waiter)
  } else {
    lane.waiters.splice(index, 0, waiter)
  }
}

function acquire(key: string, signal: AbortSignal | undefined, priority: number): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError())
  }
  const lane = lanes.get(key)
  if (!lane) {
    lanes.set(key, { waiters: [] })
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      const index = lane.waiters.indexOf(waiter)
      if (index !== -1) {
        lane.waiters.splice(index, 1)
      }
      reject(abortError())
    }
    const waiter: GitOperationWaiter = {
      priority,
      grant: () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
    }
    enqueue(lane, waiter)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function release(key: string): void {
  const lane = lanes.get(key)
  const next = lane?.waiters.shift()
  if (next) {
    next.grant()
    return
  }
  lanes.delete(key)
}

export async function runWithGitOperationLock<T>(
  key: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
  options: GitOperationLockOptions = {}
): Promise<T> {
  await acquire(key, signal, options.priority ?? 0)
  try {
    return await run()
  } finally {
    release(key)
  }
}

export function _gitOperationLockWaiterCountForTests(key: string): number {
  return lanes.get(key)?.waiters.length ?? 0
}
