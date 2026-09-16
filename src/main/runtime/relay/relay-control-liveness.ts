import type { RelayControlRequestTimeout } from './relay-control-requests'
import { RELAY_RENEWAL_JITTER_RATIO } from './relay-renewal-jitter'
import {
  RELAY_CONTROL_SILENCE_LIMIT_MS,
  RelayControlSilenceWatchdog
} from './relay-control-silence-watchdog'

// A control request that times out has two indistinguishable causes: a loaded
// relay whose reply is late, or a half-open TCP socket that swallowed the send
// (common on Windows behind NAT/VPN or across sleep-resume, where the OS reports
// the write as succeeding). Only the relay's 75s silence bound catches the
// second, and pairing has already failed by then. An RFC 6455 ping settles it
// without an application opcode: any live peer must answer with a pong.
export const RELAY_CONTROL_PROBE_INTERVAL_MS = 8_000

// One unanswered probe is UNKNOWN, not death: a cellular/VPN blackhole or a
// stalled TCP retransmit routinely swallows a single pong from a peer that is
// still there (STA-3320, mirrored from RemoteRuntimeServerHeartbeat's
// MISSED_PROBE_LIMIT). Only a run of unanswered probes is evidence — which
// matters most here, since the networks this detection exists for are exactly
// the ones that drop a lone frame.
const PROBE_MISS_LIMIT = 3

// The whole probe window (interval x limit = 24s) deliberately outlasts the
// relay's own 15s application-level ping. Relay liveness never depended on RFC
// 6455 control frames surviving end to end, so a middlebox that swallows pongs
// must not be able to convert this into a reconnect loop: a healthy cell's own
// ping lands inside the window and clears the probe even if no pong ever does.
// A teardown therefore means the pipe carried neither frame, three times over.
export type RelayControlLivenessTeardown = 'probe-unanswered' | 'silence-limit'

export type RelayControlLivenessOptions = {
  cellUrl: string
  ping: () => void
  onDead: (reason: RelayControlLivenessTeardown) => void
  silenceLimitMs?: number
  probeIntervalMs?: number
  random?: () => number
}

/** Everything that decides whether a control socket is still reachable. */
export class RelayControlLiveness {
  private readonly watchdog: RelayControlSilenceWatchdog
  private readonly probeIntervalMs: number
  private readonly random: () => number
  private probeTimer: ReturnType<typeof setTimeout> | null = null
  private missedProbes = 0
  private openedAt = 0

  constructor(private readonly options: RelayControlLivenessOptions) {
    this.watchdog = new RelayControlSilenceWatchdog(
      options.silenceLimitMs ?? RELAY_CONTROL_SILENCE_LIMIT_MS,
      () => options.onDead('silence-limit')
    )
    this.probeIntervalMs = options.probeIntervalMs ?? RELAY_CONTROL_PROBE_INTERVAL_MS
    this.random = options.random ?? Math.random
  }

  start(): void {
    this.openedAt = Date.now()
    this.watchdog.start()
  }

  noteInbound(): void {
    this.watchdog.noteInbound()
    this.clearProbe()
  }

  // A pong proves the pipe and nothing more — it can come from a socket the
  // relay has already unindexed — so it clears a probe but never feeds the
  // watchdog, whose job is to mirror the relay's own 75s bound.
  notePong(): void {
    this.clearProbe()
  }

  stop(): void {
    this.watchdog.stop()
    this.clearProbe()
  }

  /**
   * STA-7672: a close rejects as `relay_control_closed_<code>`, so a request that
   * times out instead proves the socket stayed open and never answered. When
   * nothing at all arrived since the send, the relay's ping is overdue too —
   * the signature of a half-open pipe rather than a reply running late under
   * load. Probe now instead of waiting out the 75s silence bound, which on
   * Windows let a user burn every pairing attempt against an already-dead socket.
   */
  describeTimeout(timeout: RelayControlRequestTimeout, live: boolean): string {
    const now = Date.now()
    const lastInboundAt = this.watchdog.lastInboundTime
    const diagnostics = [
      `reqKind=${timeout.kind}`,
      `cell=${this.options.cellUrl}`,
      `socketAgeMs=${this.openedAt === 0 ? 'n/a' : now - this.openedAt}`,
      `sinceInboundMs=${lastInboundAt === 0 ? 'n/a' : now - lastInboundAt}`
    ]
    if (live && lastInboundAt <= timeout.sentAt) {
      diagnostics.push(this.armProbe() ? 'probe=armed' : `probe=in-flight/${this.missedProbes}`)
    }
    return diagnostics.join(' ')
  }

  private armProbe(): boolean {
    if (this.probeTimer) {
      return false
    }
    this.missedProbes = 0
    this.sendProbe()
    return this.probeTimer !== null
  }

  private sendProbe(): void {
    try {
      this.options.ping()
    } catch {
      // A ping that throws on a live control is already the answer.
      this.options.onDead('probe-unanswered')
      return
    }
    // Jitter so a whole cohort timing out against one slow cell does not
    // terminate on the same boundary (see RELAY_RENEWAL_JITTER_RATIO).
    const spread = (this.random() * 2 - 1) * RELAY_RENEWAL_JITTER_RATIO
    this.probeTimer = setTimeout(
      () => this.onProbeUnanswered(),
      Math.max(1, Math.floor(this.probeIntervalMs * (1 + spread)))
    )
    this.probeTimer.unref?.()
  }

  private onProbeUnanswered(): void {
    this.probeTimer = null
    this.missedProbes += 1
    if (this.missedProbes >= PROBE_MISS_LIMIT) {
      this.options.onDead('probe-unanswered')
      return
    }
    this.sendProbe()
  }

  /** Any inbound frame — pong or application message — retires the probe run. */
  private clearProbe(): void {
    this.missedProbes = 0
    if (this.probeTimer) {
      clearTimeout(this.probeTimer)
      this.probeTimer = null
    }
  }
}
