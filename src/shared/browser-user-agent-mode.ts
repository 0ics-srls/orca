export type BrowserUserAgentMode = 'clean' | 'native'

export function normalizeBrowserUserAgentMode(mode: unknown): BrowserUserAgentMode {
  return mode === 'native' ? 'native' : 'clean'
}
