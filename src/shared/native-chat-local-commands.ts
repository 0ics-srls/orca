// Slash commands the chat host answers itself instead of forwarding to the agent's
// terminal. Claude's `/context` paints a grid in its own TUI and records nothing in
// the transcript, so a chat surface over that terminal never sees a reply; the host
// answers from what it can derive.

import type { AgentType } from './agent-status-types'
import type { SlashCommandSuggestion } from './native-chat-slash-commands'

export type NativeChatLocalCommand = 'context'

type NativeChatLocalCommandRow = SlashCommandSuggestion & { name: NativeChatLocalCommand }

const CONTEXT_COMMAND: NativeChatLocalCommandRow = {
  name: 'context',
  description: 'Show context usage'
}

// Why: kept out of the shared per-agent catalog, which mobile also offers, because
// only the desktop terminal-backed composer can answer these.
const LOCAL_COMMANDS: Partial<Record<AgentType, readonly NativeChatLocalCommandRow[]>> = {
  claude: [CONTEXT_COMMAND],
  openclaude: [CONTEXT_COMMAND]
}

/** Menu rows for the commands the chat host answers over this agent's terminal. */
export function getNativeChatLocalCommands(agent: AgentType): readonly NativeChatLocalCommandRow[] {
  return LOCAL_COMMANDS[agent] ?? []
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
  return getNativeChatLocalCommands(agent).find((command) => command.name === name)?.name ?? null
}
