import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'

const AUTH_URL_MARKER = 'navigate to this url to authenticate:'

/**
 * The browser sign-in link `codex login` prints, or null while its output has
 * not carried a complete one yet.
 */
export function parseCodexLoginAuthUrl(output: string): string | null {
  const plain = stripAnsiEscapeSequences(output)
  const markerIndex = plain.toLowerCase().indexOf(AUTH_URL_MARKER)
  const searchable = markerIndex === -1 ? plain : plain.slice(markerIndex + AUTH_URL_MARKER.length)
  // Why: the trailing whitespace is required, not incidental. Output arrives in
  // chunks, and a flush that ends mid-token would otherwise publish a truncated
  // link that authenticates nothing.
  const match = /(https:\/\/\S+?)[.,;:)\]]*\s/.exec(searchable)
  if (!match) {
    return null
  }
  try {
    const url = new URL(match[1])
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
