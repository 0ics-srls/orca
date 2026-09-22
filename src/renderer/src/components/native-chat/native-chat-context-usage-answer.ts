import { translate } from '@/i18n/i18n'
import {
  formatContextTokenCount,
  type NativeChatContextUsage
} from '../../../../shared/native-chat-context-usage'

/** The chat host's answer to `/context` over a terminal session. */
export function formatNativeChatContextUsageAnswer(usage: NativeChatContextUsage | null): string {
  if (!usage) {
    return translate(
      'components.native-chat.context.unavailable',
      'Context usage is not known yet. It becomes available once the agent has answered in this session.'
    )
  }
  return translate(
    'components.native-chat.context.summary',
    'Context: {{used}} / {{window}} tokens ({{percent}}%), estimated from the last response.',
    {
      used: formatContextTokenCount(usage.usedTokens),
      window: formatContextTokenCount(usage.windowTokens),
      percent: String(usage.percentage)
    }
  )
}
