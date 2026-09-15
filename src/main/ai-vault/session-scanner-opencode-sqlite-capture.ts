import type { AiVaultSession } from '../../shared/ai-vault-types'
import { timestampIso } from './session-scanner-accumulator'
import { asRecord } from './session-scanner-record-value'
import { extractPartText, readOpenCodeSqliteSession } from './session-scanner-opencode-sqlite'
import { readOpenCodeDatabase } from './session-scanner-opencode-sqlite-open'
import { canReadOpenCodeMessageParts } from './session-scanner-opencode-sqlite-schema'
import type { TranscriptMessage, TranscriptMessageRole } from './session-transcript-consumers'
import { boundedText } from './session-transcript-message-content'
import type SyncDatabase from '../sqlite/sync-database'

// Why: the session list needs the newest few messages, and the search index
// needs every one of them. That is the only difference between this read and
// `parseOpenCodeSqliteSession`, so the decoding is shared and only the query
// that selects the rows differs.

/**
 * How many text parts one session may hold before this read gives up.
 *
 * A safety valve on memory, not a policy: the rows are materialized and then
 * posted across the worker boundary, so an unbounded session would be held
 * twice. Exceeding it throws rather than returning a prefix, because a prefix
 * committed under a complete-read cursor would leave the tail unsearchable with
 * nothing on the row to say so. A failed read is retried and surfaces; a silent
 * truncation does neither. 20,000 text parts is roughly 10,000 conversation
 * turns, far past any real session.
 */
const OPENCODE_CAPTURE_PART_LIMIT = 20_000

type CaptureRow = {
  messageId: string
  role: string | null
  partData: string
  messageTimeMs: number
}

// A row this build cannot read is dropped rather than failing the session: the
// schema probe only proves the columns exist, not what any one row holds.
function toCaptureRow(value: unknown): CaptureRow | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const { message_id: messageId, role, part_data: partData, message_time: messageTime } = record
  if (
    typeof messageId !== 'string' ||
    typeof partData !== 'string' ||
    typeof messageTime !== 'number'
  ) {
    return null
  }
  return {
    messageId,
    role: typeof role === 'string' ? role : null,
    partData,
    messageTimeMs: messageTime
  }
}

/** The session the panel renders, and every message the index folds. */
export type OpenCodeSqliteCapture = {
  session: AiVaultSession | null
  messages: TranscriptMessage[]
}

function captureRole(role: string | null): TranscriptMessageRole | null {
  return role === 'user' || role === 'assistant' ? role : null
}

function buildCaptureQuery(): string {
  // Message order, then part order within a message: the same key the preview
  // read uses, run forwards and without the newest-N window.
  return `SELECT m.id AS message_id,
                 json_extract(m.data, '$.role') AS role,
                 p.data AS part_data,
                 m.time_created AS message_time
          FROM message m
          JOIN part p ON p.message_id = m.id
          WHERE m.session_id = ?
            AND json_extract(m.data, '$.role') IN ('user','assistant')
            AND json_extract(p.data, '$.type') = 'text'
          ORDER BY m.time_created ASC, m.id ASC, p.time_created ASC, p.rowid ASC
          LIMIT ?`
}

/**
 * Decode one session's whole transcript, one message per `message` row.
 *
 * Parts are joined rather than emitted separately because every other provider
 * hands a consumer one message per turn; a phrase that runs across two blocks of
 * the same turn is then still one indexable row.
 */
export function readOpenCodeSessionMessages(
  db: SyncDatabase,
  sessionId: string
): TranscriptMessage[] {
  if (!canReadOpenCodeMessageParts(db)) {
    return []
  }
  const rows = db.prepare(buildCaptureQuery()).all(sessionId, OPENCODE_CAPTURE_PART_LIMIT + 1)
  if (rows.length > OPENCODE_CAPTURE_PART_LIMIT) {
    throw new Error(
      `OpenCode session ${sessionId} holds more than ${OPENCODE_CAPTURE_PART_LIMIT} text parts; its transcript was not read.`
    )
  }

  const messages: TranscriptMessage[] = []
  let openMessageId: string | null = null
  let openParts: string[] = []
  let openRole: TranscriptMessageRole | null = null
  let openTimestamp: string | null = null

  const flush = (): void => {
    const text = openRole && openParts.length > 0 ? boundedText(openParts.join('\n')) : null
    if (openRole && text) {
      messages.push({ role: openRole, text, timestamp: openTimestamp })
    }
    openParts = []
  }

  for (const value of rows) {
    const row = toCaptureRow(value)
    if (!row) {
      continue
    }
    if (row.messageId !== openMessageId) {
      flush()
      openMessageId = row.messageId
      openRole = captureRole(row.role)
      openTimestamp = timestampIso(row.messageTimeMs)
    }
    const text = extractPartText(row.partData)
    if (text) {
      openParts.push(text)
    }
  }
  flush()
  return messages
}

/**
 * Read one OpenCode session and its whole transcript from a single open of the
 * database, so the two can never describe different generations of the session.
 * @param args.dbPath - Absolute path to the opencode.db file.
 * @param args.sessionId - Primary key in the `session` table.
 * @param args.platform - Platform used for resume-command generation.
 * @returns The parsed session (null when it does not exist) and its messages.
 */
export async function captureOpenCodeSqliteSession(args: {
  dbPath: string
  sessionId: string
  platform: NodeJS.Platform
}): Promise<OpenCodeSqliteCapture> {
  return readOpenCodeDatabase({
    dbPath: args.dbPath,
    read: (db) => {
      const session = readOpenCodeSqliteSession({ db, ...args })
      // No session row is no transcript: the id names nothing in this database.
      return { session, messages: session ? readOpenCodeSessionMessages(db, args.sessionId) : [] }
    }
  })
}
