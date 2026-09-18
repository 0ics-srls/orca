import { RotateCcw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  getNativeChatResumeOnRestartSnapshot,
  requestNativeChatResumeOnRestartDialog,
  subscribeNativeChatResumeOnRestart
} from '../native-chat-resume-on-restart-store'
import { useSyncExternalStore } from 'react'

export function NativeChatResumeStatusSegment({
  iconOnly
}: {
  iconOnly: boolean
}): React.JSX.Element | null {
  const structuredEnabled = useAppStore(
    (store) => store.settings?.experimentalStructuredNativeChat === true
  )
  const { candidates } = useSyncExternalStore(
    subscribeNativeChatResumeOnRestart,
    getNativeChatResumeOnRestartSnapshot,
    getNativeChatResumeOnRestartSnapshot
  )
  if (!structuredEnabled || candidates.length === 0) {
    return null
  }

  const label = translate(
    'auto.components.status.bar.NativeChatResumeStatusSegment.label',
    '{{value0}} chats to reconnect',
    { value0: candidates.length }
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={requestNativeChatResumeOnRestartDialog}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/70"
          aria-label={translate(
            'auto.components.status.bar.NativeChatResumeStatusSegment.ariaLabel',
            '{{value0}} chats available to reconnect',
            { value0: candidates.length }
          )}
        >
          <RotateCcw className="size-3 text-muted-foreground" />
          {!iconOnly ? (
            <span className="text-[11px]">{label}</span>
          ) : (
            <span>{candidates.length}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {translate(
          'auto.components.status.bar.NativeChatResumeStatusSegment.tooltip',
          'Open interrupted chats available to reconnect'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
