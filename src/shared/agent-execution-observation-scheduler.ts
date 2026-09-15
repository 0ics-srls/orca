import type { ExecutionHostId } from './execution-host'
import type { AgentStatusRunVerdict } from './agent-status-run'
import type {
  AgentExecutionAttachment,
  AgentExecutionHostInventory,
  AgentExecutionObservation,
  AgentExecutionObservationSchedulerOptions
} from './agent-execution-observation'

type ActiveAttachment = AgentExecutionAttachment & { generation: number }
type PendingRequest = { resolve: (observation: AgentExecutionObservation) => void }
type HostScan = { controller: AbortController; promise: Promise<void> }

const DEFAULT_COALESCE_MS = 25
const DEFAULT_MAX_CONCURRENT_SCANS = 2
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 5_000

/** Coalesces attachment requests into bounded, host-scoped inventories. */
export class AgentExecutionObservationScheduler {
  private readonly attachments = new Map<string, ActiveAttachment>()
  private readonly pending = new Map<string, PendingRequest[]>()
  private readonly scans = new Map<ExecutionHostId, HostScan>()
  private readonly retryCountByHost = new Map<ExecutionHostId, number>()
  private readonly captureRevisionByHost = new Map<ExecutionHostId, number>()
  private readonly published = new Map<string, AgentExecutionObservation>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private readonly coalesceMs: number
  private readonly maxConcurrentHostScans: number
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number
  private readonly now: () => number
  private readonly schedule: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>
  private readonly cancelSchedule: (handle: ReturnType<typeof setTimeout>) => void

  constructor(
    private readonly scanHost: (
      hostId: ExecutionHostId,
      signal: AbortSignal,
      attachments: readonly ActiveAttachment[]
    ) => Promise<AgentExecutionHostInventory>,
    private readonly publish: (observation: AgentExecutionObservation) => void,
    options: AgentExecutionObservationSchedulerOptions = {}
  ) {
    this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS
    this.maxConcurrentHostScans = Math.max(
      1,
      Math.floor(options.maxConcurrentHostScans ?? DEFAULT_MAX_CONCURRENT_SCANS)
    )
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS)
    this.retryMaxMs = Math.max(this.retryBaseMs, options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS)
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle))
  }

  register(attachment: AgentExecutionAttachment): void {
    if (this.stopped) {
      return
    }
    const previous = this.attachments.get(attachment.executionId)
    const same =
      previous &&
      previous.hostId === attachment.hostId &&
      previous.paneKey === attachment.paneKey &&
      previous.runId === attachment.runId &&
      previous.role === attachment.role &&
      previous.continuityOf === attachment.continuityOf &&
      previous.hostEpoch === attachment.hostEpoch &&
      previous.processIncarnation === attachment.processIncarnation &&
      previous.providerInvocation === attachment.providerInvocation
    if (same) {
      return
    }
    const requests = this.pending.get(attachment.executionId)
    if (requests && previous) {
      const superseded = this.buildUnverifiable(attachment.executionId, previous)
      for (const request of requests) {
        request.resolve(superseded)
      }
      this.pending.delete(attachment.executionId)
    }
    this.attachments.set(attachment.executionId, {
      ...attachment,
      generation: (previous?.generation ?? 0) + 1
    })
    this.request(attachment.executionId)
  }

  unregister(executionId: string): void {
    const attachment = this.attachments.get(executionId)
    if (!attachment) {
      return
    }
    this.attachments.delete(executionId)
    const requests = this.pending.get(executionId)
    if (requests) {
      const observation = this.buildUnverifiable(executionId, attachment)
      for (const request of requests) {
        request.resolve(observation)
      }
      this.pending.delete(executionId)
    }
    this.published.delete(executionId)
    this.cancelObsoleteHostScan(attachment.hostId)
  }

  request(executionId: string): Promise<AgentExecutionObservation> {
    const attachment = this.attachments.get(executionId)
    if (!attachment || this.stopped) {
      return Promise.resolve(this.buildUnverifiable(executionId, attachment))
    }
    const request = new Promise<AgentExecutionObservation>((resolve) => {
      const requests = this.pending.get(executionId)
      if (requests) {
        requests.push({ resolve })
      } else {
        this.pending.set(executionId, [{ resolve }])
      }
    })
    this.armTimer()
    return request
  }

  getPublished(executionId: string): AgentExecutionObservation | undefined {
    return this.published.get(executionId)
  }
  getRegisteredExecutionIds(): readonly string[] {
    return [...this.attachments.keys()]
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      this.cancelSchedule(this.timer)
      this.timer = null
    }
    for (const scan of this.scans.values()) {
      scan.controller.abort()
    }
    this.scans.clear()
    for (const [executionId, requests] of this.pending) {
      const observation = this.buildUnverifiable(executionId, this.attachments.get(executionId))
      for (const request of requests) {
        request.resolve(observation)
      }
    }
    this.pending.clear()
  }

  private armTimer(): void {
    if (this.timer || this.stopped) {
      return
    }
    this.timer = this.schedule(() => {
      this.timer = null
      void this.flush()
    }, this.coalesceMs)
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.pending.size === 0) {
      return
    }
    const byHost = new Map<ExecutionHostId, ActiveAttachment[]>()
    for (const executionId of this.pending.keys()) {
      const attachment = this.attachments.get(executionId)
      if (!attachment) {
        this.pending.delete(executionId)
        continue
      }
      const hostAttachments = byHost.get(attachment.hostId)
      if (hostAttachments) {
        hostAttachments.push(attachment)
      } else {
        byHost.set(attachment.hostId, [attachment])
      }
    }
    let started = false
    for (const [hostId, attachments] of byHost) {
      if (this.scans.has(hostId) || this.scans.size >= this.maxConcurrentHostScans) {
        continue
      }
      this.startHostScan(hostId, attachments)
      started = true
    }
    if (this.pending.size > 0 && !started && this.scans.size === 0 && !this.timer) {
      this.armTimer()
    }
  }

  private startHostScan(hostId: ExecutionHostId, attachments: ActiveAttachment[]): void {
    const controller = new AbortController()
    const promise = this.scanHost(hostId, controller.signal, attachments)
      .then((inventory) => {
        if (inventory.hostId !== hostId) {
          throw new Error('execution_observation_host_mismatch')
        }
        this.retryCountByHost.delete(hostId)
        this.resolveHostScan(hostId, attachments, inventory)
      })
      .catch(() => {
        this.resolveHostFailure(hostId, attachments)
        if (!this.stopped && this.hasCurrentHostAttachment(hostId)) {
          const retry = (this.retryCountByHost.get(hostId) ?? 0) + 1
          this.retryCountByHost.set(hostId, retry)
          const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** (retry - 1))
          this.schedule(() => {
            if (this.stopped) {
              return
            }
            for (const attachment of this.attachments.values()) {
              if (attachment.hostId === hostId && !this.pending.has(attachment.executionId)) {
                this.pending.set(attachment.executionId, [])
              }
            }
            this.armTimer()
          }, delay)
        }
      })
      .finally(() => {
        if (this.scans.get(hostId)?.promise === promise) {
          this.scans.delete(hostId)
        }
        if (this.pending.size > 0) {
          this.armTimer()
        }
      })
    this.scans.set(hostId, { controller, promise })
  }

  private resolveHostScan(
    hostId: ExecutionHostId,
    requested: ActiveAttachment[],
    inventory: AgentExecutionHostInventory
  ): void {
    const revision = (this.captureRevisionByHost.get(hostId) ?? 0) + 1
    this.captureRevisionByHost.set(hostId, revision)
    for (const requestedAttachment of requested) {
      const current = this.attachments.get(requestedAttachment.executionId)
      if (!current || current.generation !== requestedAttachment.generation) {
        continue
      }
      this.resolveAttachment(current, {
        executionId: current.executionId,
        ...(current.runId !== undefined ? { runId: current.runId } : {}),
        ...(current.role !== undefined ? { role: current.role } : {}),
        ...(current.continuityOf !== undefined ? { continuityOf: current.continuityOf } : {}),
        hostId,
        hostEpoch: inventory.hostEpoch,
        captureRevision: revision,
        observedAt: inventory.capturedAt,
        inventoryCoverage: inventory.inventoryCoverage,
        verdict: this.resolveVerdict(current, inventory)
      })
    }
  }

  private resolveHostFailure(hostId: ExecutionHostId, requested: ActiveAttachment[]): void {
    const revision = (this.captureRevisionByHost.get(hostId) ?? 0) + 1
    this.captureRevisionByHost.set(hostId, revision)
    for (const requestedAttachment of requested) {
      const current = this.attachments.get(requestedAttachment.executionId)
      if (!current || current.generation !== requestedAttachment.generation) {
        continue
      }
      this.resolveAttachment(current, {
        executionId: current.executionId,
        ...(current.runId !== undefined ? { runId: current.runId } : {}),
        ...(current.role !== undefined ? { role: current.role } : {}),
        ...(current.continuityOf !== undefined ? { continuityOf: current.continuityOf } : {}),
        hostId,
        hostEpoch: current.hostEpoch,
        captureRevision: revision,
        observedAt: this.now(),
        inventoryCoverage: 'partial',
        verdict: 'unverifiable'
      })
    }
  }

  private resolveAttachment(
    attachment: ActiveAttachment,
    observation: AgentExecutionObservation
  ): void {
    this.published.set(attachment.executionId, observation)
    const requests = this.pending.get(attachment.executionId) ?? []
    this.pending.delete(attachment.executionId)
    this.publish(observation)
    for (const request of requests) {
      request.resolve(observation)
    }
  }

  private resolveVerdict(
    attachment: AgentExecutionAttachment,
    inventory: AgentExecutionHostInventory
  ): AgentStatusRunVerdict {
    if (inventory.inventoryCoverage !== 'complete') {
      return 'unverifiable'
    }
    const observed = inventory.verdictByProcessIncarnation?.get(attachment.processIncarnation ?? '')
    if (observed) {
      return observed
    }
    if (attachment.processIncarnation) {
      return inventory.processIncarnations.has(attachment.processIncarnation) ? 'live' : 'exited'
    }
    if (attachment.providerInvocation) {
      return inventory.providerInvocations?.has(attachment.providerInvocation) ? 'live' : 'exited'
    }
    return 'unverifiable'
  }

  private buildUnverifiable(
    executionId: string,
    attachment: ActiveAttachment | undefined
  ): AgentExecutionObservation {
    const hostId = attachment?.hostId ?? 'local'
    const revision = (this.captureRevisionByHost.get(hostId) ?? 0) + 1
    this.captureRevisionByHost.set(hostId, revision)
    return {
      executionId,
      ...(attachment?.runId !== undefined ? { runId: attachment.runId } : {}),
      ...(attachment?.role !== undefined ? { role: attachment.role } : {}),
      ...(attachment?.continuityOf !== undefined ? { continuityOf: attachment.continuityOf } : {}),
      hostId,
      hostEpoch: attachment?.hostEpoch ?? 'unknown',
      captureRevision: revision,
      observedAt: this.now(),
      inventoryCoverage: 'partial',
      verdict: 'unverifiable'
    }
  }

  private hasCurrentHostAttachment(hostId: ExecutionHostId): boolean {
    return [...this.attachments.values()].some((attachment) => attachment.hostId === hostId)
  }
  private cancelObsoleteHostScan(hostId: ExecutionHostId): void {
    const hasPending = [...this.pending.keys()].some(
      (executionId) => this.attachments.get(executionId)?.hostId === hostId
    )
    if (!hasPending) {
      this.scans.get(hostId)?.controller.abort()
    }
  }
}
