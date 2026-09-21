import { assertJsonTextStructureWithinLimits } from './json-text-structure-limit'

export const PULL_REQUEST_FIELDS_MARKER = '<<<ORCA_PR_FIELDS>>>'
export const PULL_REQUEST_BODY_MARKER = '<<<ORCA_PR_BODY>>>'
export const PULL_REQUEST_END_MARKER = '<<<ORCA_PR_END>>>'

const PULL_REQUEST_MARKERS = [
  PULL_REQUEST_FIELDS_MARKER,
  PULL_REQUEST_BODY_MARKER,
  PULL_REQUEST_END_MARKER
] as const

export const INCOMPLETE_ENVELOPE_ERROR = 'Expected a complete pull request fields envelope.'

type PullRequestFieldsReply = {
  base: string | null
  title: string | null
  draft: boolean | null
  body: string | null
}

type PullRequestHeaderFields = Omit<PullRequestFieldsReply, 'body'>

type EnvelopeScan =
  | { kind: 'none'; sawMarker: boolean }
  | { kind: 'truncated' }
  | {
      kind: 'complete'
      headerStart: number
      headerEnd: number
      bodyStart: number
      bodyEnd: number
    }

const PULL_REQUEST_FIELDS_JSON_STRUCTURE_LIMITS = {
  structuralTokens: 64,
  nestingDepth: 8
} as const

const EMPTY_HEADER_FIELDS: PullRequestHeaderFields = { base: null, title: null, draft: null }

/** Neutralizes marker tokens in untrusted prompt context (descriptions, issue
 *  text, commits, patches) so an echoed copy can never act as a delimiter. */
export function neutralizePullRequestMarkers(value: string): string {
  let neutralized = value
  for (const marker of PULL_REQUEST_MARKERS) {
    neutralized = neutralized.split(marker).join(`\`${marker}\``)
  }
  return neutralized
}

export function parsePullRequestFieldsReply(raw: string): PullRequestFieldsReply {
  const envelope = scanEnvelope(raw)
  if (envelope.kind === 'complete') {
    return {
      ...parseEnvelopeHeader(raw.slice(envelope.headerStart, envelope.headerEnd)),
      body: raw.slice(envelope.bodyStart, envelope.bodyEnd)
    }
  }
  if (envelope.kind === 'truncated') {
    // Why: the header of an unterminated envelope may be an echoed sample, so it
    // is never salvaged through the legacy path.
    throw new Error(INCOMPLETE_ENVELOPE_ERROR)
  }
  try {
    return parseJsonFields(extractJsonObjectText(raw))
  } catch (error) {
    if (envelope.sawMarker) {
      throw new Error(INCOMPLETE_ENVELOPE_ERROR)
    }
    throw error
  }
}

function scanEnvelope(text: string): EnvelopeScan {
  let sawMarker = false
  let headerStart: number | null = null
  let headerEnd: number | null = null
  let bodyStart: number | null = null
  let bodyEnd: number | null = null
  let lastEnd: number | null = null
  let depth = 0
  let lineStart = 0

  for (;;) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const afterLine = newline === -1 ? text.length : newline + 1
    const line = text.slice(lineStart, lineEnd).trim()

    if (line === PULL_REQUEST_FIELDS_MARKER) {
      sawMarker = true
      // Why: once the body has opened, a fields line is body content — restarting
      // there would let quoted or injected metadata replace the real header.
      if (bodyStart === null) {
        headerStart = afterLine
      }
    } else if (line === PULL_REQUEST_BODY_MARKER) {
      sawMarker = true
      if (headerStart !== null && bodyStart === null) {
        headerEnd = lineStart
        bodyStart = afterLine
        depth = 1
      } else if (bodyStart !== null && bodyEnd === null) {
        depth += 1
      }
    } else if (line === PULL_REQUEST_END_MARKER) {
      sawMarker = true
      if (bodyStart !== null && bodyEnd === null) {
        lastEnd = lineStart
        depth -= 1
        // Why: body/end pairs nest, so the body ends at the terminator that closes
        // the one the header opened — not at the first or the last one seen.
        if (depth === 0) {
          bodyEnd = lineStart
        }
      }
    }

    if (newline === -1) {
      break
    }
    lineStart = afterLine
  }

  const resolvedEnd = bodyEnd ?? lastEnd
  if (headerStart !== null && headerEnd !== null && bodyStart !== null && resolvedEnd !== null) {
    return { kind: 'complete', headerStart, headerEnd, bodyStart, bodyEnd: resolvedEnd }
  }
  return headerStart !== null ? { kind: 'truncated' } : { kind: 'none', sawMarker }
}

function parseEnvelopeHeader(content: string): PullRequestHeaderFields {
  const text = extractJsonObjectText(content)
  if (!text) {
    return EMPTY_HEADER_FIELDS
  }
  assertJsonTextStructureWithinLimits(text, PULL_REQUEST_FIELDS_JSON_STRUCTURE_LIMITS)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Why: a malformed header must not discard a byte-intact body.
    return EMPTY_HEADER_FIELDS
  }
  return isRecord(parsed) ? readHeaderFields(parsed) : EMPTY_HEADER_FIELDS
}

function parseJsonFields(text: string): PullRequestFieldsReply {
  assertJsonTextStructureWithinLimits(text, PULL_REQUEST_FIELDS_JSON_STRUCTURE_LIMITS)
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object.')
  }
  return {
    ...readHeaderFields(parsed),
    body: typeof parsed.body === 'string' ? parsed.body : null
  }
}

function readHeaderFields(parsed: Record<string, unknown>): PullRequestHeaderFields {
  return {
    base: typeof parsed.base === 'string' ? parsed.base : null,
    title: typeof parsed.title === 'string' ? parsed.title : null,
    draft: typeof parsed.draft === 'boolean' ? parsed.draft : null
  }
}

function extractJsonObjectText(raw: string): string {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
