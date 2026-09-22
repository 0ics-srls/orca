/**
 * At-most-once announcement ledger for a notification event that has its own identity.
 *
 * Distinct from the burst cooldown beside it, which answers "has this workspace been noisy
 * lately" and expires on a timer. An event identity does not expire: the same completion is the
 * same completion an hour later, so a time window would let a slow second window raise it twice.
 *
 * Split into ask and record rather than one check-and-set, because the caller has a second gate
 * after this one: a duplicate must be refused before that gate is spent, and the event must be
 * recorded only once it is really being announced. A key of `undefined` is a sender with no event
 * identity, which this ledger has nothing to say about — the burst cooldown is its only gate.
 *
 * Bounded by count rather than by age, and insertion-ordered so eviction drops the oldest. The
 * only thing eviction can cost is a duplicate for an event that was already announced and has
 * since had this many newer events behind it, which no real sequence reaches.
 */
const MAX_REMEMBERED_EVENTS = 256

export function wasNotificationEventSeen(seen: Set<string>, key: string | undefined): boolean {
  return key !== undefined && seen.has(key)
}

export function rememberNotificationEvent(seen: Set<string>, key: string | undefined): void {
  if (key === undefined) {
    return
  }
  seen.add(key)
  while (seen.size > MAX_REMEMBERED_EVENTS) {
    const oldest = seen.values().next()
    if (oldest.done) {
      break
    }
    seen.delete(oldest.value)
  }
}
