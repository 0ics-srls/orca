/** Matches the captured agy command dialog only while it owns the bottom of the screen. */
export function isAntigravityCommandApprovalScreen(rows: readonly string[]): boolean {
  const lines = rows.map((row) => row.trim()).filter(Boolean)
  const footer = lines.at(-1) ?? ''
  const navigation = lines.at(-2) ?? ''
  if (
    !footer.startsWith('esc to cancel') ||
    navigation !== '↑/↓ Navigate · tab Amend · ctrl+g edit/expand command'
  ) {
    return false
  }
  const question = lines.lastIndexOf('Run this command?')
  if (question === -1) {
    return false
  }
  const choices = lines.slice(question + 1, -2).map((line) => line.replace(/^>\s*/, ''))
  return (
    choices[0] === '1. Yes, run command' &&
    choices.some((line) => line.startsWith('2. Yes, and always allow in this conversation')) &&
    choices.some((line) => line.startsWith('3. Yes, and always allow for commands')) &&
    choices.at(-1) === '4. No, cancel'
  )
}
