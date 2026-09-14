// Why: an xterm selection is a rectangle of screen cells, not logical text.
// Agent CLIs paint their messages behind a fixed left gutter, so every copied
// line carried that gutter into the clipboard and pasted replies came out
// indented (#19770).
//
// Only the run of spaces that *every* non-blank line shares is removed, so
// relative indentation — nested bullets, fenced code, YAML — survives. A
// selection that starts mid-line, or that covers any column-0 line, shares a
// run of zero and comes back untouched.

// Terminal cells never hold tabs (the emulator expands them) and xterm folds
// non-breaking spaces into plain ones, so spaces are the whole alphabet here.
const LEADING_SPACES = /^ */

function measureIndent(line: string): number {
  return LEADING_SPACES.exec(line)?.[0].length ?? 0
}

// xterm joins rows with CRLF on Windows, so split('\n') leaves the CR behind.
function splitTerminator(rawLine: string): readonly [text: string, terminator: string] {
  return rawLine.endsWith('\r') ? [rawLine.slice(0, -1), '\r'] : [rawLine, '']
}

function measureGutter(lines: readonly string[]): number {
  let gutter = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const indent = measureIndent(line)
    // Blank and whitespace-only lines are evidence of nothing either way.
    if (indent === line.length) {
      continue
    }
    gutter = Math.min(gutter, indent)
    if (gutter === 0) {
      return 0
    }
  }
  return Number.isFinite(gutter) ? gutter : 0
}

export function stripTerminalSelectionGutter(selection: string): string {
  const lines = selection.split('\n').map(splitTerminator)
  const gutter = measureGutter(lines.map(([text]) => text))
  if (gutter === 0) {
    return selection
  }
  return lines
    .map(([text, terminator]) => text.slice(Math.min(measureIndent(text), gutter)) + terminator)
    .join('\n')
}
