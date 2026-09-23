/** Explorer name-filter matching, shared so the host can filter a scan exactly like the renderer. */

// Why: accepted pasted file-filter queries are still on a renderer hot path;
// tokenize whitespace directly instead of allocating a regex split array.
export function splitFileNameFilterTokens(query: string): string[] {
  const tokens: string[] = []
  let tokenStart = -1
  for (let index = 0; index <= query.length; index += 1) {
    const isEnd = index === query.length
    if (!isEnd && !isFileNameFilterWhitespace(query.charCodeAt(index))) {
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (tokenStart !== -1) {
      tokens.push(query.slice(tokenStart, index).toLocaleLowerCase())
      tokenStart = -1
    }
  }
  return tokens
}

function isFileNameFilterWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  )
}

export function pathMatchesFileNameFilterTokens(
  relativePath: string,
  tokens: readonly string[]
): boolean {
  if (tokens.length === 0) {
    return true
  }
  // Why: callers pass already-normalized paths — lowercasing only, no second normalize per path per keystroke.
  const haystack = relativePath.toLocaleLowerCase()
  return tokens.every((token) => haystack.includes(token))
}
