import type { AgentSessionPtyWriteRefusal } from './agent-session-pty-write-admission'

export function structuredChatPtyWriteRefusalCopy(
  refusal: AgentSessionPtyWriteRefusal,
  action: 'terminal-send' | 'worker-start'
): string | null {
  if (refusal.ownerRuntimeKind !== 'native') {
    return null
  }
  return action === 'worker-start'
    ? 'The target terminal is in Structured Chat. Switch it to Terminal, then retry `orca orchestration worker-start`.'
    : 'The target terminal is in Structured Chat. Switch it to Terminal, then retry `orca terminal send`.'
}

/**
 * What to tell someone whose history Resume was refused because something else
 * already owns that conversation.
 *
 * Deliberately not `describeAgentSessionPtyWriteRefusal`, which is diagnostic
 * copy carrying a pid and a code. Uncertainty is never reported as death: an
 * owner Orca cannot confirm asks the reader to reconnect, and nothing here ever
 * suggests forcing the session open or running a CLI command.
 */
export function aiVaultResumeRefusalCopy(refusal: AgentSessionPtyWriteRefusal): string {
  if (refusal.code === 'agent_session_ownership_unknown') {
    return 'Orca cannot confirm who owns this session yet. Reconnect to its host and try again.'
  }
  return refusal.ownerRuntimeKind === 'native'
    ? 'This session is already open in a chat. Open the chat to continue.'
    : 'This session is already open in a terminal. Switch to that terminal to continue.'
}
