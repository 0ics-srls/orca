import type { AgentSessionJournalIdentity } from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionAccountHome,
  AgentSessionExecutionLocation
} from '../../../shared/agent-session-record'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'

type RoutedAgent = 'claude' | 'codex'
type SessionRoute = { adapter: StructuredAgentSessionAdapter; state: 'live' | 'stopped' }

export class StructuredAgentSessionAdapterRouter implements StructuredAgentSessionAdapter {
  private readonly routes = new Map<string, SessionRoute>()
  private allAdaptersClosed = false
  private closing = false
  private inFlightAcquisitions = 0
  private acquisitionDrain: Promise<void> | null = null
  private resolveAcquisitionDrain: (() => void) | null = null
  private closePromise: Promise<void> | null = null

  constructor(
    private readonly adapters: Record<RoutedAgent, StructuredAgentSessionAdapter>,
    private readonly closeAdapters: () => Promise<void>
  ) {}

  supportsCreate = (location: AgentSessionExecutionLocation, agent: string): boolean => {
    const adapter = this.adapterForAgent(agent)
    return adapter ? (adapter.supportsLocation?.(location) ?? false) : false
  }

  supportsLocation = (location: AgentSessionExecutionLocation): boolean =>
    Object.values(this.adapters).some((adapter) => adapter.supportsLocation?.(location) ?? false)

  async acquire(input: Parameters<StructuredAgentSessionAdapter['acquire']>[0]) {
    if (this.closing) {
      throw new Error('structured session adapter router is closing')
    }
    const adapter = this.requireAgent(input.identity)
    this.allAdaptersClosed = false
    this.beginAcquisition()
    try {
      const acquired = await adapter.acquire(input)
      this.routes.set(input.identity.sessionId, { adapter, state: 'live' })
      return acquired
    } finally {
      this.endAcquisition()
    }
  }

  async releaseAcquisition(input: { sessionId: string }): Promise<boolean> {
    const route = this.routes.get(input.sessionId)
    if (route) {
      try {
        return (await route.adapter.releaseAcquisition?.(input)) === true
      } finally {
        this.routes.delete(input.sessionId)
      }
    }
    if (this.allAdaptersClosed) {
      return true
    }
    let released = false
    for (const candidate of Object.values(this.adapters)) {
      released = (await candidate.releaseAcquisition?.(input)) === true || released
    }
    return released
  }

  dispatch: StructuredAgentSessionAdapter['dispatch'] = (input) =>
    this.owner(input.sessionId).dispatch(input)

  rewindSupport: NonNullable<StructuredAgentSessionAdapter['rewindSupport']> = (sessionId) =>
    this.liveOwnerOrNull(sessionId)?.rewindSupport?.(sessionId) ?? {
      supported: false,
      reason: 'unsupported'
    }

  rewind: NonNullable<StructuredAgentSessionAdapter['rewind']> = (input) =>
    this.owner(input.sessionId).rewind?.(input) ??
    Promise.resolve({ ok: false, reason: 'unsupported' })

  recoverRewind: NonNullable<StructuredAgentSessionAdapter['recoverRewind']> = (input) =>
    this.owner(input.sessionId).recoverRewind?.(input) ??
    Promise.resolve({ ok: false, reason: 'unsupported' })

  compact: NonNullable<StructuredAgentSessionAdapter['compact']> = (input) => {
    const compact = this.owner(input.sessionId).compact
    if (!compact) {
      throw new Error('Compaction is unavailable for this provider.')
    }
    return compact(input)
  }

  cancelTurn: StructuredAgentSessionAdapter['cancelTurn'] = (input) =>
    this.owner(input.sessionId).cancelTurn(input)

  stopBackgroundTasks: NonNullable<StructuredAgentSessionAdapter['stopBackgroundTasks']> = (
    input
  ) => {
    const stop = this.owner(input.sessionId).stopBackgroundTasks
    return stop ? stop(input) : Promise.resolve({ cancelled: false })
  }

  backgroundTaskState: NonNullable<StructuredAgentSessionAdapter['backgroundTaskState']> = (
    sessionId
  ) => this.liveOwnerOrNull(sessionId)?.backgroundTaskState?.(sessionId)

  readCommands: NonNullable<StructuredAgentSessionAdapter['readCommands']> = (sessionId) =>
    this.liveOwnerOrNull(sessionId)?.readCommands?.(sessionId)

  answerPrompt: StructuredAgentSessionAdapter['answerPrompt'] = (input) =>
    this.owner(input.sessionId).answerPrompt(input)

  setOption: StructuredAgentSessionAdapter['setOption'] = (input) =>
    this.owner(input.sessionId).setOption(input)

  readOptions = (input: { sessionId: string; fence: number }) => {
    const reader = this.owner(input.sessionId).readOptions
    if (!reader) {
      throw new Error(`structured session ${input.sessionId} does not report options`)
    }
    return reader(input)
  }

  readOptionRestoreFailures = (sessionId: string): readonly string[] =>
    this.owner(sessionId).readOptionRestoreFailures?.(sessionId) ?? []

  historyFilePath = (input: { identity: AgentSessionJournalIdentity }) =>
    this.requireAgent(input.identity).historyFilePath?.(input) ?? Promise.resolve(null)

  providerHistoryWindow = (input: {
    identity: AgentSessionJournalIdentity
    accountHome: AgentSessionAccountHome
  }) => this.requireAgent(input.identity).providerHistoryWindow?.(input) ?? Promise.resolve(null)

  closeSession = (sessionId: string): Promise<boolean> =>
    this.stopSession(sessionId, (adapter) => adapter.closeSession)

  forceCloseSession = (sessionId: string): Promise<boolean> =>
    this.stopSession(sessionId, (adapter) => adapter.forceCloseSession ?? adapter.closeSession)

  disposeSession = (sessionId: string): Promise<boolean> =>
    this.stopSession(sessionId, (adapter) => adapter.disposeSession ?? adapter.closeSession)

  private async stopSession(
    sessionId: string,
    selectStop: (
      adapter: StructuredAgentSessionAdapter
    ) => NonNullable<StructuredAgentSessionAdapter['closeSession']> | undefined
  ): Promise<boolean> {
    const route = this.routes.get(sessionId)
    if (!route) {
      return this.allAdaptersClosed
    }
    if (route.state === 'stopped') {
      return true
    }
    const stop = selectStop(route.adapter)
    const stopped = await stop?.call(route.adapter, sessionId)
    if (stopped === true) {
      route.state = 'stopped'
      return true
    }
    return false
  }

  async closeAll(): Promise<void> {
    if (this.allAdaptersClosed) {
      return
    }
    if (this.closePromise) {
      return this.closePromise
    }
    this.closing = true
    this.closePromise = (async () => {
      try {
        await this.waitForAcquisitions()
        await this.closeAdapters()
        this.routes.clear()
        this.allAdaptersClosed = true
      } finally {
        this.closing = false
        this.closePromise = null
      }
    })()
    return this.closePromise
  }

  /** Drops a per-session stop receipt after the host releases its durable owner. */
  acknowledgeSessionRelease = (sessionId: string): void => {
    this.routes.delete(sessionId)
  }

  private owner(sessionId: string): StructuredAgentSessionAdapter {
    const adapter = this.liveOwnerOrNull(sessionId)
    if (!adapter) {
      throw new Error(`no live structured adapter owns ${sessionId}`)
    }
    return adapter
  }

  private liveOwnerOrNull(sessionId: string): StructuredAgentSessionAdapter | null {
    const route = this.routes.get(sessionId)
    return route?.state === 'live' ? route.adapter : null
  }

  private requireAgent(identity: AgentSessionJournalIdentity): StructuredAgentSessionAdapter {
    const adapter = this.adapterForAgent(identity.agent)
    if (!adapter) {
      throw new Error(`structured sessions do not support ${identity.agent}`)
    }
    return adapter
  }

  private adapterForAgent(agent: string): StructuredAgentSessionAdapter | null {
    return agent === 'claude' || agent === 'codex' ? this.adapters[agent] : null
  }

  private beginAcquisition(): void {
    if (this.inFlightAcquisitions === 0) {
      this.acquisitionDrain = new Promise((resolve) => {
        this.resolveAcquisitionDrain = resolve
      })
    }
    this.inFlightAcquisitions += 1
  }

  private endAcquisition(): void {
    this.inFlightAcquisitions -= 1
    if (this.inFlightAcquisitions === 0) {
      this.resolveAcquisitionDrain?.()
      this.resolveAcquisitionDrain = null
      this.acquisitionDrain = null
    }
  }

  private waitForAcquisitions(): Promise<void> {
    return this.acquisitionDrain ?? Promise.resolve()
  }
}
