// Mobile counterpart of desktop's send classification gate
// (src/renderer/src/components/native-chat/NativeChatComposer.tsx): slash/skill
// sends are TUI control actions, not chat turns — they never echo as a user
// bubble, because the transcript will never contain a matching user turn and
// the optimistic echo would never reconcile.

import {
  getNativeChatAgentProfile,
  getVerifiedNativeChatCommands
} from '../../../src/shared/native-chat-agent-profiles'
import { withoutSurfacedOutputCommands } from '../../../src/shared/native-chat-command-output'
import {
  classifyNativeChatSend,
  type NativeChatSendClassification,
  type SlashCommandSuggestion
} from '../../../src/shared/native-chat-slash-commands'

export type { NativeChatSendClassification }

/** The curated catalog mobile offers over a terminal session. Why: mobile's
 *  transcript fold does not surface command replies, so a command answered only
 *  by one would do nothing here. */
export function getMobileNativeChatCommands(agent: string): readonly SlashCommandSuggestion[] {
  return withoutSurfacedOutputCommands(agent, getVerifiedNativeChatCommands(agent))
}

/** Classify a mobile chat send for the tab's agent. Mobile has no skill picker,
 *  so there is never a picker-origin token that reclassifies a `/token` as chat. */
export function classifyMobileNativeChatSend(
  agent: string | null,
  text: string
): NativeChatSendClassification {
  if (!agent) {
    return 'chat'
  }
  const profile = getNativeChatAgentProfile(agent)
  return classifyNativeChatSend(
    text,
    getMobileNativeChatCommands(agent),
    null,
    profile?.skillPrefix ?? null
  )
}
