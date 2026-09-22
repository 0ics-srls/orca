import { PackedRefsLockGate } from './packed-refs-lock-gate'
import { RepoMaintenanceCooldowns } from './repo-maintenance-cooldowns'
import {
  PACKED_REFS_LOCK_WAIT_MS,
  REPO_MAINTENANCE_ATTEMPT_DEADLINE_MS,
  REPO_MAINTENANCE_CLEAN_COOLDOWN_MS,
  REPO_MAINTENANCE_FAILURE_COOLDOWN_MS,
  REPO_MAINTENANCE_LOCKED_COOLDOWN_MS,
  REPO_MAINTENANCE_MAX_REMAINDER_ROUNDS,
  REPO_MAINTENANCE_PACKED_COOLDOWN_MS,
  REPO_MAINTENANCE_QUIET_PERIOD_MS,
  REPO_MAINTENANCE_REMAINDER_DELAY_MS,
  RepoMaintenanceInterrupted,
  type RepoMaintenanceAttemptOutcome,
  type RepoMaintenanceOptions,
  type RepoMaintenanceSpan,
  type RepoMaintenanceTarget,
  type RepoMaintenanceTask,
  type RepoMaintenanceTaskOutcome
} from './repo-maintenance-policy'
import { runMaintenanceTask } from './repo-maintenance-task-run'

/**
 * The scheduler half of idle repo maintenance: when to probe, when to pack, when
 * to stand down. It is deliberately blind to what a task maintains -- it probes,
 * compares to the task's own threshold, packs, and re-probes. The thresholds,
 * the task contract and the host contract live in `./repo-maintenance-policy`.
 */

/** Give up until the next real activity rather than re-arming forever. */
const MAX_DEFERRALS = 6
/** Each deferral doubles the wait, so a busy app is retried rarely, not hammered. */
const MAX_DEFERRAL_BACKOFF_MULTIPLIER = 8
/** Armed repos are evicted oldest-first past this; the next write on one re-arms it. */
const MAX_TRACKED_REPOS = 64
/** Cooldowns are per repo *and* task, so the ceiling has to cover both. */
const MAX_TRACKED_COOLDOWNS = MAX_TRACKED_REPOS * 8

type TrackedRepo = {
  target: RepoMaintenanceTarget
  timer: ReturnType<typeof setTimeout> | null
  deferrals: number
  /** Consecutive re-arms for a remainder; a write to the repo resets it. */
  remainders: number
}

const noopSpan: RepoMaintenanceSpan = { setAttribute: () => {} }

const TASK_COOLDOWN_MS: Record<RepoMaintenanceTaskOutcome, number> = {
  packed: REPO_MAINTENANCE_PACKED_COOLDOWN_MS,
  // None: a remainder is work still owed, and the attempt re-arms to finish it.
  partially_packed: 0,
  below_threshold: REPO_MAINTENANCE_CLEAN_COOLDOWN_MS,
  unresolved: REPO_MAINTENANCE_CLEAN_COOLDOWN_MS,
  locked: REPO_MAINTENANCE_LOCKED_COOLDOWN_MS,
  failed: REPO_MAINTENANCE_FAILURE_COOLDOWN_MS
}

/** A deadline means something is stuck: back off instead of retrying straight away. */
function hitDeadline(signal: AbortSignal): boolean {
  return signal.reason instanceof RepoMaintenanceInterrupted && signal.reason.deadline
}

export class RepoMaintenance {
  private readonly tracked = new Map<string, TrackedRepo>()
  private readonly cooldowns: RepoMaintenanceCooldowns
  private readonly now: () => number
  private readonly isAppBusy: () => boolean
  private readonly observe: NonNullable<RepoMaintenanceOptions['observe']>
  private readonly quietPeriodMs: number
  private readonly remainderDelayMs: number
  private readonly onError: (error: unknown) => void
  // Why: at most one maintenance attempt anywhere. A pack holds a general git
  // admission slot for its whole run, and two at once would halve git throughput
  // on a small host. The slot is never released while a pack that could hold
  // `packed-refs.lock` is still running -- an interrupt cancels the work and
  // waits for it to stop.
  private inFlight: Promise<void> | null = null
  private inFlightAbort: AbortController | null = null
  private readonly lockGate = new PackedRefsLockGate()
  // Why a count, not a flag: several ref-touching operations overlap routinely
  // (a create's fetch inside a create), and the last one out reopens the window.
  private suspensions = 0
  private lastAttempt: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(options: RepoMaintenanceOptions = {}) {
    this.now = options.now ?? Date.now
    this.cooldowns = new RepoMaintenanceCooldowns(this.now, MAX_TRACKED_COOLDOWNS)
    this.isAppBusy = options.isBusy ?? (() => false)
    this.observe = options.observe ?? ((attempt) => attempt(noopSpan))
    this.quietPeriodMs = options.quietPeriodMs ?? REPO_MAINTENANCE_QUIET_PERIOD_MS
    this.remainderDelayMs = options.remainderDelayMs ?? REPO_MAINTENANCE_REMAINDER_DELAY_MS
    this.onError = options.onError ?? (() => {})
  }

  /**
   * Record a write to `target`'s repo and (re)start its quiet-period countdown.
   * Every call pushes the attempt further out, so a burst of fetches or a
   * worktree create can never be interrupted by maintenance it triggered.
   */
  arm(target: RepoMaintenanceTarget): void {
    if (this.disposed) {
      return
    }
    const existing = this.tracked.get(target.key)
    if (existing?.timer) {
      clearTimeout(existing.timer)
    }
    const tracked: TrackedRepo = {
      target,
      timer: null,
      deferrals: existing?.deferrals ?? 0,
      remainders: 0
    }
    this.tracked.delete(target.key)
    this.evictOldestBeyondCap()
    this.tracked.set(target.key, tracked)
    this.schedule(target.key, tracked)
  }

  /** Resolves once the attempt started by the most recent timer has settled. */
  whenAttemptSettled(): Promise<void> {
    return this.lastAttempt
  }

  /**
   * Wait out the `packed-refs` rewrite, if one is in progress.
   *
   * Deliberately not a kill. The lock is held for 0.03-1.37s of a 23-32s pack;
   * the rest is the prune phase, during which a concurrent `fetch --prune`,
   * `branch -D` or `update-ref` measurably succeeds because per-ref locks last
   * microseconds and Git retries for `core.filesRefLockTimeout`. Signalling the
   * child there buys nothing and strands a lock file about one time in five.
   *
   * Free when no pack is running, which is almost always.
   */
  awaitPackedRefsLockRelease(): Promise<void> {
    return this.lockGate.whenReleased(PACKED_REFS_LOCK_WAIT_MS)
  }

  /**
   * Push every armed repository's attempt out by a full quiet period.
   *
   * User-initiated ref work is evidence the user is active in the app, not just
   * in one repo, and it is free -- no key to resolve, no subprocess, nothing at
   * all when nothing is armed.
   */
  postponeAll(): void {
    if (this.disposed) {
      return
    }
    for (const [key, tracked] of this.tracked) {
      if (tracked.timer) {
        clearTimeout(tracked.timer)
      }
      tracked.deferrals = 0
      this.schedule(key, tracked)
    }
  }

  /**
   * Hold the repository open for work that is about to touch refs.
   *
   * Two things at once: no *new* attempt can start for any repository until the
   * returned release is called, and the caller waits out any `packed-refs`
   * rewrite already in progress. A prune already running is left alone to
   * finish -- it does not block the caller.
   */
  async pause(_reason: string): Promise<() => void> {
    this.suspensions += 1
    let released = false
    try {
      await this.awaitPackedRefsLockRelease()
    } catch {
      // The wait cannot reject, but a release must exist even if it did.
    }
    return () => {
      if (!released) {
        released = true
        this.suspensions -= 1
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.inFlightAbort?.abort(new RepoMaintenanceInterrupted('disposed'))
    for (const tracked of this.tracked.values()) {
      if (tracked.timer) {
        clearTimeout(tracked.timer)
      }
    }
    this.tracked.clear()
    this.cooldowns.clear()
  }

  private isBusy(tracked: TrackedRepo): boolean {
    return this.isAppBusy() || (tracked.target.isBusy?.() ?? false)
  }

  private schedule(key: string, tracked: TrackedRepo, delayMs = this.quietPeriodMs): void {
    const timer = setTimeout(() => {
      tracked.timer = null
      this.lastAttempt = this.attempt(key).catch((error) => this.onError(error))
    }, delayMs)
    // Never hold the process open for maintenance.
    timer.unref?.()
    tracked.timer = timer
  }

  private evictOldestBeyondCap(): void {
    while (this.tracked.size >= MAX_TRACKED_REPOS) {
      const oldest = this.tracked.keys().next()
      if (oldest.done) {
        return
      }
      const evicted = this.tracked.get(oldest.value)
      if (evicted?.timer) {
        clearTimeout(evicted.timer)
      }
      this.tracked.delete(oldest.value)
    }
  }

  /**
   * `counted` spends the give-up budget. Waiting behind another repository's
   * pack, or yielding to work Orca asked us to yield to, does not: both end on
   * their own, so charging for them would let a busy machine starve a repo
   * until its next fetch. Only "the app is busy" is charged.
   */
  private defer(key: string, tracked: TrackedRepo, counted: boolean, delayMs?: number): void {
    // A fetch that landed while this attempt was probing already re-armed the
    // repo; that entry is fresher, so the deferral must not overwrite it.
    if (this.disposed || this.tracked.has(key)) {
      return
    }
    if (counted) {
      if (tracked.deferrals >= MAX_DEFERRALS) {
        return
      }
      tracked.deferrals += 1
    }
    this.tracked.set(key, tracked)
    const multiplier = Math.min(2 ** tracked.deferrals, MAX_DEFERRAL_BACKOFF_MULTIPLIER)
    this.schedule(key, tracked, delayMs ?? this.quietPeriodMs * multiplier)
  }

  private async attempt(key: string): Promise<void> {
    const tracked = this.tracked.get(key)
    if (!tracked || this.disposed) {
      return
    }
    this.tracked.delete(key)
    const due = tracked.target.tasks.filter((task) => !this.cooldowns.isCoolingDown(key, task.id))
    if (due.length === 0) {
      return
    }
    if (this.inFlight !== null) {
      this.defer(key, tracked, false)
      return
    }
    if (this.suspensions > 0 || this.isBusy(tracked)) {
      this.defer(key, tracked, true)
      return
    }
    const abort = new AbortController()
    const deadline = setTimeout(
      () => abort.abort(new RepoMaintenanceInterrupted('attempt deadline', true)),
      REPO_MAINTENANCE_ATTEMPT_DEADLINE_MS
    )
    deadline.unref?.()
    const run = this.observe((span) => this.runDueTasks(key, tracked, due, span, abort.signal))
    this.inFlight = run
    this.inFlightAbort = abort
    try {
      await run
    } finally {
      clearTimeout(deadline)
      if (this.inFlight === run) {
        this.inFlight = null
        this.inFlightAbort = null
      }
    }
  }

  private async runDueTasks(
    key: string,
    tracked: TrackedRepo,
    due: readonly RepoMaintenanceTask[],
    span: RepoMaintenanceSpan,
    signal: AbortSignal
  ): Promise<void> {
    span.setAttribute('repo.maintenance_key', key)
    span.setAttribute('repo.maintenance_tasks', due.map((task) => task.id).join(','))
    // Every await below carries the signal, so a caller waiting in `pause()` is
    // never stuck behind a probe that has already been told to stop.
    if (await tracked.target.isOptedOut?.(signal)) {
      for (const task of tracked.target.tasks) {
        this.cooldowns.start(key, task.id, REPO_MAINTENANCE_CLEAN_COOLDOWN_MS)
      }
      this.recordAttempt(span, 'opted_out')
      return
    }
    let remainder = false
    for (const task of due) {
      if (signal.aborted) {
        this.endAborted(key, tracked, span, signal)
        return
      }
      // The quiet window can close between tasks; re-check before spending a git slot.
      if (this.suspensions > 0 || this.isBusy(tracked)) {
        this.recordAttempt(span, 'deferred')
        this.defer(key, tracked, true)
        return
      }
      remainder = (await this.runTask(key, task, span, signal)) || remainder
    }
    this.recordAttempt(span, 'completed')
    if (remainder && tracked.remainders < REPO_MAINTENANCE_MAX_REMAINDER_ROUNDS) {
      tracked.remainders += 1
      this.defer(key, tracked, false, this.remainderDelayMs)
    }
  }

  /** Runs one task and records its verdict; resolves true when it is owed another turn. */
  private async runTask(
    key: string,
    task: RepoMaintenanceTask,
    span: RepoMaintenanceSpan,
    signal: AbortSignal
  ): Promise<boolean> {
    const verdict = await runMaintenanceTask(task, span, this.lockGate, signal, this.now)
    this.cooldowns.start(key, task.id, TASK_COOLDOWN_MS[verdict.outcome])
    return verdict.remainder
  }

  /** Record an aborted attempt: retry soon if Orca yielded, back off if it stalled. */
  private endAborted(
    key: string,
    tracked: TrackedRepo,
    span: RepoMaintenanceSpan,
    signal: AbortSignal
  ): void {
    if (hitDeadline(signal)) {
      for (const task of tracked.target.tasks) {
        this.cooldowns.start(key, task.id, REPO_MAINTENANCE_FAILURE_COOLDOWN_MS)
      }
      this.recordAttempt(span, 'timed_out')
      return
    }
    this.recordAttempt(span, 'interrupted')
    this.defer(key, tracked, false)
  }

  private recordAttempt(span: RepoMaintenanceSpan, outcome: RepoMaintenanceAttemptOutcome): void {
    span.setAttribute('repo.maintenance_outcome', outcome)
  }
}
