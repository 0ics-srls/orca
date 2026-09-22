// Slash commands the chat host answers itself instead of forwarding to the agent's
// terminal. OMP's `/context` builds a panel inside its TUI and records nothing in
// the session file, so a chat surface over that terminal never sees a reply; the
// host answers from the transcript it already reads.

import type { AgentType } from './agent-status-types'

export type NativeChatLocalCommand = 'context'

const LOCAL_COMMANDS: Partial<Record<AgentType, readonly NativeChatLocalCommand[]>> = {
  omp: ['context']
}

/** The host-answered command a draft invokes, or null when the agent should see it.
 *  Untrimmed on purpose: the TUIs only read a line-leading token as a command. */
export function nativeChatLocalCommand(
  agent: AgentType,
  draft: string
): NativeChatLocalCommand | null {
  const firstToken = draft.split(/\s/, 1)[0] ?? ''
  if (!firstToken.startsWith('/')) {
    return null
  }
  const name = firstToken.slice(1)
  return LOCAL_COMMANDS[agent]?.find((command) => command === name) ?? null
}
