// Why: xterm selections are screen cells, not logical text. Agent CLIs paint
// their messages behind a fixed left gutter (Claude Code indents continuation
// lines by two spaces), so every copied line carries that gutter into the
// clipboard and pasted replies come out indented (#19770).
//
// Only the run of spaces that *every* selected line shares is removed, so
// relative indentation — nested bullets, fenced code, YAML — survives intact.
// A selection that starts mid-line has a non-space first line, which makes the
// shared run zero and turns this into a no-op.

const LEADING_SPACES = /^ */

// xterm writes CRLF joins on Windows; keep the terminator it chose.
function splitCarriageReturn(line: string): [string, string] {
  return line.endsWith('\r') ? [line.slice(0, -1), '\r'] : [line, '']
}

/** Width of the space run shared by every non-blank line, or 0 when there is none. */
export function measureTerminalSelectionGutter(selection: string): number {
  let gutter = Number.POSITIVE_INFINITY
  for (const rawLine of selection.split('\n')) {
    const [line] = splitCarriageReturn(rawLine)
    const indent = LEADING_SPACES.exec(line)?.[0].length ?? 0
    // Blank and whitespace-only lines carry no gutter evidence either way.
    if (indent === line.length) {
      continue
    }
    if (indent < gutter) {
      gutter = indent
      if (gutter === 0) {
        return 0
      }
    }
  }
  return Number.isFinite(gutter) ? gutter : 0
}

export function stripTerminalSelectionGutter(selection: string): string {
  if (!selection) {
    return selection
  }
  const gutter = measureTerminalSelectionGutter(selection)
  if (gutter === 0) {
    return selection
  }
  return selection
    .split('\n')
    .map((rawLine) => {
      const [line, terminator] = splitCarriageReturn(rawLine)
      const indent = LEADING_SPACES.exec(line)?.[0].length ?? 0
      return line.slice(Math.min(indent, gutter)) + terminator
    })
    .join('\n')
}
