import type { RelayControlRequestTimeout } from './relay-control-requests'
import {
  RELAY_CONTROL_SILENCE_LIMIT_MS,
  RelayControlSilenceWatchdog
} from './relay-control-silence-watchdog'

// A control request that times out has two indistinguishable causes: a loaded
// relay whose reply is late, or a half-open TCP socket that swallowed the send
// (common on Windows behind NAT/VPN or across sleep-resume, where the OS reports
// the write as succeeding). Only the relay's 75s silence bound catches the
// second, and pairing has already failed by then. An RFC 6455 ping settles it in
// seconds and needs no application opcode: any live peer must answer with a pong.
//
// The deadline deliberately exceeds the relay's own 15s ping cadence. The relay
// keeps its liveness at the application layer (a JSON `ping` frame), so nothing
// in normal operation depends on control frames surviving end to end; a window
// shorter than that cadence would turn a middlebox that swallows pongs into a
// reconnect loop. At 20s a healthy cell clears the probe either way — its own
// ping lands inside the window — so a fired probe means the pipe carried
// neither, which is the definition of dead.
export const RELAY_CONTROL_PROBE_DEADLINE_MS = 20_000

export type RelayControlLivenessOptions = {
  cellUrl: string
  ping: () => void
  onDead: () => void
  silenceLimitMs?: number
  probeDeadlineMs?: number
}

/** Everything that decides whether a control socket is still reachable. */
export class RelayControlLiveness {
  private readonly watchdog: RelayControlSilenceWatchdog
  private readonly probeDeadlineMs: number
  private probeTimer: ReturnType<typeof setTimeout> | null = null
  private openedAt = 0

  constructor(private readonly options: RelayControlLivenessOptions) {
    this.watchdog = new RelayControlSilenceWatchdog(
      options.silenceLimitMs ?? RELAY_CONTROL_SILENCE_LIMIT_MS,
      options.onDead
    )
    this.probeDeadlineMs = options.probeDeadlineMs ?? RELAY_CONTROL_PROBE_DEADLINE_MS
  }

  start(): void {
    this.openedAt = Date.now()
    this.watchdog.start()
  }

  noteInbound(): void {
    this.watchdog.noteInbound()
    this.disarmProbe()
  }

  // A pong proves the pipe and nothing more — it can come from a socket the
  // relay has already unindexed — so it clears a probe but never feeds the
  // watchdog, whose job is to mirror the relay's own 75s bound.
  notePong(): void {
    this.disarmProbe()
  }

  stop(): void {
    this.watchdog.stop()
    this.disarmProbe()
  }

  /**
   * STA-7672: a close rejects as `relay_control_closed_<code>`, so a request that
   * times out instead proves the socket stayed open and never answered. When
   * nothing at all arrived since the send, the relay's 15s ping is overdue too —
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
      diagnostics.push(this.probe() ? 'probe=armed' : 'probe=in-flight')
    }
    return diagnostics.join(' ')
  }

  private probe(): boolean {
    if (this.probeTimer) {
      return false
    }
    try {
      this.options.ping()
    } catch {
      // A ping that throws on a live control is already the answer.
      this.options.onDead()
      return false
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null
      this.options.onDead()
    }, this.probeDeadlineMs)
    this.probeTimer.unref?.()
    return true
  }

  private disarmProbe(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer)
      this.probeTimer = null
    }
  }
}
