const MUSE_QUESTION_OPTION_RE = /^\s*\d+\.\s+\S/m

/** Returns the prompt's position when Muse is visibly waiting for a user choice. */
export function findMuseInteractiveQuestionIndex(normalized: string): number | null {
  const questionIndex = normalized.lastIndexOf('request user input')
  if (questionIndex === -1) {
    return null
  }
  const prompt = normalized.slice(questionIndex)
  if (prompt.includes('muse code')) {
    return null
  }
  const optionCount = prompt.match(new RegExp(MUSE_QUESTION_OPTION_RE.source, 'gm'))?.length ?? 0
  if (!prompt.includes('enter to select') || optionCount < 2) {
    return null
  }
  return questionIndex
}
