const FOREGROUND_AGENT_WRAPPER_PROCESS_NAMES = new Set(['node', 'python', 'python3'])
const PYTHON_PROCESS_RE = /^python(?:\d+(?:\.\d+)*)?$/

export function isAgentForegroundWrapperProcessName(normalized: string): boolean {
  return (
    FOREGROUND_AGENT_WRAPPER_PROCESS_NAMES.has(normalized) || PYTHON_PROCESS_RE.test(normalized)
  )
}
