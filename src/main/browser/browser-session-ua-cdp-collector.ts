import WebSocket from 'ws'

export type BrowserSessionUaCdpRequest = Readonly<{
  targetType: string
  resourceType: string
  url: string
  userAgent: string | null
  clientHints: Readonly<Record<string, string>>
}>

type PendingRequest = {
  targetType: string
  resourceType?: string
  url?: string
  headers?: Record<string, string>
}

type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

export class BrowserSessionUaCdpCollector {
  readonly diagnostics: string[] = []
  private readonly pendingCommands = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly targetsBySessionId = new Map<string, string>()
  private readonly requests = new Map<string, PendingRequest[]>()
  private readonly webSockets = new Map<string, PendingRequest>()
  private nextCommandId = 1

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.handleMessage(JSON.parse(data.toString()) as CdpMessage))
  }

  static async connect(port: number): Promise<BrowserSessionUaCdpCollector> {
    const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
      response.json()
    )) as { webSocketDebuggerUrl: string }
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return new BrowserSessionUaCdpCollector(socket)
  }

  async installAutoAttach(): Promise<void> {
    await this.send('Target.setDiscoverTargets', { discover: true })
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
  }

  snapshot(): BrowserSessionUaCdpRequest[] {
    const result: BrowserSessionUaCdpRequest[] = []
    const requests = [...this.requests.values()].flat()
    for (const request of [...requests, ...this.webSockets.values()]) {
      if (!request.url || !request.headers) {
        continue
      }
      const normalizedHeaders = Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), String(value)])
      )
      result.push({
        targetType: request.targetType,
        resourceType: request.resourceType ?? 'Other',
        url: request.url,
        userAgent: normalizedHeaders['user-agent'] ?? null,
        clientHints: Object.fromEntries(
          Object.entries(normalizedHeaders).filter(([key]) => key.startsWith('sec-ch-ua'))
        )
      })
    }
    return result
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return
    }
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => resolve())
      this.socket.close()
    })
  }

  private send(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    const id = this.nextCommandId++
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject })
    })
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return promise
  }

  private handleMessage(message: CdpMessage): void {
    if (this.diagnostics.length < 50 && message.method) {
      this.diagnostics.push(`event:${message.method}:${message.sessionId ?? 'root'}`)
    }
    if (message.id !== undefined) {
      const pending = this.pendingCommands.get(message.id)
      if (!pending) {
        return
      }
      this.pendingCommands.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP command failed'))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (message.method === 'Target.attachedToTarget') {
      const params = message.params as
        | { sessionId?: string; targetInfo?: { type?: string } }
        | undefined
      if (params?.sessionId) {
        this.diagnostics.push(
          `attached:${params.targetInfo?.type ?? 'unknown'}:${params.sessionId}`
        )
        this.targetsBySessionId.set(params.sessionId, params.targetInfo?.type ?? 'unknown')
        void this.prepareTarget(params.sessionId)
      }
      return
    }
    const sessionId = message.sessionId ?? 'browser'
    const params = message.params ?? {}
    if (message.method === 'Runtime.exceptionThrown') {
      this.diagnostics.push(`exception:${JSON.stringify(params)}`)
      return
    }
    const requestId = typeof params.requestId === 'string' ? params.requestId : undefined
    if (!requestId) {
      return
    }
    const key = `${sessionId}:${requestId}`
    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request as { url?: string } | undefined
      const hops = this.requests.get(key) ?? []
      const pending = hops.find((candidate) => candidate.url === undefined)
      const hop = pending ?? this.createPending(sessionId)
      if (!pending) {
        hops.push(hop)
      }
      hop.url = request?.url
      hop.resourceType = typeof params.type === 'string' ? params.type : 'Other'
      this.requests.set(key, hops)
    } else if (message.method === 'Network.requestWillBeSentExtraInfo') {
      const hops = this.requests.get(key) ?? []
      const pending = hops.find((candidate) => candidate.headers === undefined)
      const hop = pending ?? this.createPending(sessionId)
      if (!pending) {
        hops.push(hop)
      }
      hop.headers = (params.headers as Record<string, string> | undefined) ?? {}
      this.requests.set(key, hops)
    } else if (message.method === 'Network.webSocketCreated') {
      const pending = this.webSockets.get(key) ?? this.createPending(sessionId)
      pending.url = typeof params.url === 'string' ? params.url : undefined
      pending.resourceType = 'WebSocket'
      this.webSockets.set(key, pending)
    } else if (message.method === 'Network.webSocketWillSendHandshakeRequest') {
      const request = params.request as { headers?: Record<string, string> } | undefined
      const pending = this.webSockets.get(key) ?? this.createPending(sessionId)
      pending.headers = request?.headers ?? {}
      this.webSockets.set(key, pending)
    }
  }

  private createPending(sessionId: string): PendingRequest {
    return { targetType: this.targetsBySessionId.get(sessionId) ?? 'unknown' }
  }

  private async prepareTarget(sessionId: string): Promise<void> {
    // Paused Electron targets acknowledge queued domain enables only after Runtime resumes them.
    const network = this.send('Network.enable', {}, sessionId)
    const runtime = this.send('Runtime.enable', {}, sessionId)
    await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((error: unknown) => {
      this.diagnostics.push(`resume-error:${sessionId}:${String(error)}`)
    })
    const enabled = await Promise.allSettled([network, runtime])
    this.diagnostics.push(
      `enabled:${sessionId}:${enabled.map((result) => result.status).join(',')}`
    )
    this.diagnostics.push(`resumed:${sessionId}`)
  }
}

export async function waitForBrowserCdpEndpoint(port: number): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (targets.ok) {
        return
      }
    } catch {
      // Electron has not opened the debugger endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('browser_cdp_endpoint_timeout')
}
