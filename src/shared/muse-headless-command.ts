// `muse exec` is a one-shot that exits. Flags may precede the subcommand
// (`muse --yolo exec …`). A quoted prompt is one token, so it does not match.
export function isMuseHeadlessOneShotCommand(tokens: readonly string[]): boolean {
  return tokens.slice(1).some((token) => token === 'exec')
}
