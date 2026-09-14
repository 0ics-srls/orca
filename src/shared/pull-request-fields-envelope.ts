/** Sentinel-delimited reply envelope for generated pull request fields: the
 *  markdown body travels raw between markers, never as a JSON string literal,
 *  so quotes, backticks and fences in the prose cannot break the parse. */
export const PULL_REQUEST_FIELDS_MARKER = '<<<ORCA_PR_FIELDS>>>'
export const PULL_REQUEST_BODY_MARKER = '<<<ORCA_PR_BODY>>>'
export const PULL_REQUEST_END_MARKER = '<<<ORCA_PR_END>>>'

/** One reply read out of either the envelope or the legacy JSON object; `null`
 *  means the model did not supply the field. */
export type PullRequestFieldsReply = {
  base: string | null
  title: string | null
  draft: boolean | null
  body: string | null
}

type MarkerLine = { start: number; afterLine: number }

export function parsePullRequestFieldsEnvelope(raw: string): PullRequestFieldsReply | null {
  const text = stripEnclosingCodeFence(raw.trim())
  const markers = findMarkerLines(text)
  if (!markers.body) {
    return null
  }
  const headerStart = markers.fields ? markers.fields.afterLine : 0
  const bodyEnd = markers.end ? markers.end.start : text.length
  return {
    ...readHeaderFields(text.slice(headerStart, markers.body.start)),
    body: text.slice(markers.body.afterLine, bodyEnd)
  }
}

/** Unwraps a fence the model wrapped its whole reply in; leaves fences that
 *  merely appear inside the reply alone. */
export function stripEnclosingCodeFence(text: string): string {
  const body = getEnclosingFenceBody(text)
  return body === null ? text : body.trim()
}

function findMarkerLines(text: string): {
  fields: MarkerLine | null
  body: MarkerLine | null
  end: MarkerLine | null
} {
  let fields: MarkerLine | null = null
  let body: MarkerLine | null = null
  let end: MarkerLine | null = null
  let lineStart = 0
  for (;;) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const afterLine = newline === -1 ? text.length : newline + 1
    // Trimming absorbs indentation and the CR of a CRLF reply.
    const line = text.slice(lineStart, lineEnd).trim()
    if (line === PULL_REQUEST_BODY_MARKER) {
      body ??= { start: lineStart, afterLine }
    } else if (line === PULL_REQUEST_FIELDS_MARKER) {
      if (!fields && !body) {
        fields = { start: lineStart, afterLine }
      }
    } else if (line === PULL_REQUEST_END_MARKER && body) {
      // Last one wins: a body that quotes the marker cannot truncate the reply.
      end = { start: lineStart, afterLine }
    }
    if (newline === -1) {
      return { fields, body, end }
    }
    lineStart = afterLine
  }
}

function readHeaderFields(header: string): Omit<PullRequestFieldsReply, 'body'> {
  let base: string | null = null
  let title: string | null = null
  let draft: boolean | null = null
  for (const headerLine of header.split('\n')) {
    const line = headerLine.trim()
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = unwrapQuoted(line.slice(separator + 1).trim())
    if (!value) {
      continue
    }
    if (key === 'base') {
      base ??= value
    } else if (key === 'title') {
      title ??= value
    } else if (key === 'draft') {
      draft ??= readBoolean(value)
    }
  }
  return { base, title, draft }
}

// Why: branch names and titles never legitimately carry wrapping quotes, and a
// model that quotes `base` would otherwise produce an unusable base branch.
function unwrapQuoted(value: string): string {
  if (value.length < 2) {
    return value
  }
  const first = value[0]
  if ((first === '"' || first === "'" || first === '`') && value.endsWith(first)) {
    return value.slice(1, -1).trim()
  }
  return value
}

function readBoolean(value: string): boolean | null {
  const normalized = value.toLowerCase()
  if (normalized === 'true') {
    return true
  }
  return normalized === 'false' ? false : null
}

function getEnclosingFenceBody(text: string): string | null {
  if (!text.startsWith('```') || !text.endsWith('```')) {
    return null
  }
  const bodyStart = getInfoLineEnd(text)
  const closeStart = text.length - 3
  if (bodyStart === null || closeStart <= bodyStart) {
    return null
  }
  const bodyEnd = getBodyEndBeforeClosingFence(text, closeStart)
  return bodyEnd === null || bodyEnd < bodyStart ? null : text.slice(bodyStart, bodyEnd)
}

/** End of the opening fence's info line (```json, ```markdown, …), or null when
 *  the line is not a fence opener. */
function getInfoLineEnd(text: string): number | null {
  for (let index = 3; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      return index + 1
    }
    if (code === 13) {
      return text.charCodeAt(index + 1) === 10 ? index + 2 : index + 1
    }
    if (code === 96) {
      return null
    }
  }
  return null
}

function getBodyEndBeforeClosingFence(text: string, closeStart: number): number | null {
  const previousCode = text.charCodeAt(closeStart - 1)
  if (previousCode === 10) {
    return text.charCodeAt(closeStart - 2) === 13 ? closeStart - 2 : closeStart - 1
  }
  if (previousCode === 13) {
    return closeStart - 1
  }
  return null
}
