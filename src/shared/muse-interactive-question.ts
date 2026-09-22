const NUMBERED_OPTION_LINE_RE = /^\s*\d+\.?\s+\S/m
const MENU_FOOTER_RE = /enter to select|esc to interrupt|tab for an optional note|esc quits/

function lastNonBlankLine(text: string): string {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? ''
    if (line.length > 0) {
      return line
    }
  }
  return ''
}

/**
 * A numbered "Request user input" menu that owns the bottom of the screen.
 * A status-bar label, a stale menu above the composer, or a narrated copy does not.
 */
export function findMuseInteractiveQuestionIndex(normalized: string): number | null {
  const questionIndex = normalized.lastIndexOf('request user input')
  if (questionIndex === -1) {
    return null
  }
  const prompt = normalized.slice(questionIndex)
  if (prompt.includes('❯')) {
    return null
  }
  const optionCount = prompt.match(new RegExp(NUMBERED_OPTION_LINE_RE.source, 'gm'))?.length ?? 0
  if (optionCount < 2 || !prompt.includes('enter to select')) {
    return null
  }
  const tail = lastNonBlankLine(prompt)
  if (!MENU_FOOTER_RE.test(tail) && !NUMBERED_OPTION_LINE_RE.test(tail)) {
    return null
  }
  return questionIndex
}

const APPROVAL_CHOICES = [
  'allow once',
  'reject once',
  'allow for this session',
  'block for this session'
] as const

/** Muse's approval menu, only while those choices own the bottom of the screen. */
export function findMuseApprovalPromptIndex(normalized: string): number | null {
  const indexes = APPROVAL_CHOICES.map((choice) => normalized.lastIndexOf(choice))
  if (indexes.some((index) => index === -1)) {
    return null
  }
  const start = Math.min(...indexes)
  const prompt = normalized.slice(start)
  // The banner can stay above the menu. A composer glyph after the choices means it closed.
  if (prompt.includes('❯')) {
    return null
  }
  const tail = lastNonBlankLine(prompt)
  if (!APPROVAL_CHOICES.some((choice) => tail.includes(choice)) && !MENU_FOOTER_RE.test(tail)) {
    return null
  }
  return start
}
