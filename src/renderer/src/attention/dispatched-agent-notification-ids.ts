/**
 * The notification ids this renderer has handed to main, per subject, until an acknowledgement
 * retires them.
 *
 * Why recorded rather than rebuilt: an id is minted from the row's `stateStartedAt` at dispatch,
 * and that field moves afterwards — settling pushes the working start into history, and a settled
 * structured row is re-stamped by any later journal row (a cancel's status note, for one). Rebuilding
 * the id at acknowledgement time from the row as it then stands can miss a banner that is still on
 * screen; remembering what was actually sent cannot.
 *
 * In memory only: main's banner registry is per-process too, and a reload falls back to the
 * acknowledgement's rebuild from the current row.
 */
const MAX_SUBJECTS = 256
const MAX_IDS_PER_SUBJECT = 20

const idsBySubject = new Map<string, string[]>()

export function recordDispatchedAgentNotificationId(subjectKey: string, id: string): void {
  const ids = (idsBySubject.get(subjectKey) ?? []).filter((existing) => existing !== id)
  ids.push(id)
  // Re-insert so eviction drops the subject least recently notified, not the first ever seen.
  idsBySubject.delete(subjectKey)
  idsBySubject.set(subjectKey, ids.slice(-MAX_IDS_PER_SUBJECT))
  if (idsBySubject.size > MAX_SUBJECTS) {
    const oldest = idsBySubject.keys().next().value
    if (oldest !== undefined) {
      idsBySubject.delete(oldest)
    }
  }
}

/** Every id recorded for this subject since the last take; the record is cleared. */
export function takeDispatchedAgentNotificationIds(subjectKey: string): readonly string[] {
  const ids = idsBySubject.get(subjectKey) ?? []
  idsBySubject.delete(subjectKey)
  return ids
}

export function resetDispatchedAgentNotificationIdsForTests(): void {
  idsBySubject.clear()
}
