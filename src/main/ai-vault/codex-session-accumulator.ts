import type { AiVaultSession } from '../../shared/ai-vault-types'
import { codexSessionAliasBeats, codexSessionAliasKey } from './codex-session-root-dedup'

/**
 * Retains canonical rows in occurrence order and releases discarded aliases
 * immediately. Per retained row this holds one array slot and one index entry
 * keyed by the row's own sessionId, so an unlimited scan never pins an alias
 * key string or wrapper object per session.
 */
export class CodexSessionAccumulator {
  private readonly rows: (AiVaultSession | undefined)[] = []
  // Live positions of winning occurrences; same-id rows with different alias keys share a bucket.
  private readonly winnerPositionsBySessionId = new Map<string, number | number[]>()
  private liveCount = 0

  get size(): number {
    return this.liveCount
  }

  add(session: AiVaultSession): void {
    const key = codexSessionAliasKey(session)
    if (!key) {
      this.retain(session)
      return
    }
    const bucket = this.winnerPositionsBySessionId.get(session.sessionId)
    if (bucket === undefined) {
      this.winnerPositionsBySessionId.set(session.sessionId, this.retain(session))
      return
    }
    const positions = typeof bucket === 'number' ? [bucket] : bucket
    const rivals = positions.filter(
      (position) => codexSessionAliasKey(this.rows[position]!) === key
    )
    const best = rivals.length > 0 ? this.rows[rivals[0]!] : undefined
    let kept = positions
    if (best && best !== session) {
      if (!codexSessionAliasBeats(session, best)) {
        return
      }
      for (const position of rivals) {
        this.rows[position] = undefined
        this.liveCount--
      }
      kept = positions.filter((position) => !rivals.includes(position))
    }
    kept.push(this.retain(session))
    this.winnerPositionsBySessionId.set(session.sessionId, kept.length === 1 ? kept[0]! : kept)
  }

  sessions(): AiVaultSession[] {
    return this.rows.filter((row): row is AiVaultSession => row !== undefined)
  }

  private retain(session: AiVaultSession): number {
    this.liveCount++
    return this.rows.push(session) - 1
  }
}
