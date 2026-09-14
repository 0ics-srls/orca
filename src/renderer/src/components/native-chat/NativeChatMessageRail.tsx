// The rail itself: a column of ticks down the right edge of the transcript, one
// per user message, with a hover panel that previews them and jumps on click.

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import type { NativeChatMessageRailState } from './use-native-chat-message-rail'

function railItemLabel(item: NativeChatRailItem): string {
  if (item.text.length > 0) {
    return item.text
  }
  return item.hasImages
    ? translate('components.native-chat.railImageMessage', 'Image attachment')
    : translate('components.native-chat.railEmptyMessage', 'Message')
}

export function NativeChatMessageRail({
  rail,
  scrollRef,
  onSelect
}: {
  rail: NativeChatMessageRailState
  scrollRef: React.RefObject<HTMLDivElement | null>
  onSelect: (item: NativeChatRailItem) => void
}): React.JSX.Element | null {
  if (!rail.visible) {
    return null
  }

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <div
          data-native-chat-rail
          aria-label={translate('components.native-chat.railLabel', 'Your messages')}
          // The rail overlays the transcript without being inside it, so a wheel
          // here would otherwise land on nothing and freeze the scroll.
          onWheel={(event) => {
            const element = scrollRef.current
            if (element) {
              element.scrollTop += event.deltaY
            }
          }}
          className="group/rail absolute inset-y-0 right-[14px] z-10 flex w-4 cursor-default flex-col items-center justify-center gap-2"
        >
          {rail.ticks.map((item) => (
            <span
              key={item.id}
              aria-hidden
              className={cn(
                'h-[3px] shrink-0 rounded-full transition-all duration-150',
                item.id === rail.activeId
                  ? 'w-5 bg-foreground/30 group-hover/rail:bg-foreground/70'
                  : 'w-3 bg-foreground/10 group-hover/rail:bg-foreground/25'
              )}
            />
          ))}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="left" align="center" className="w-72 p-1">
        <ul className="scrollbar-sleek max-h-64 overflow-y-auto overflow-x-hidden">
          {rail.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  item.id === rail.activeId && 'bg-accent'
                )}
              >
                <span
                  className={cn(
                    'line-clamp-2 text-xs leading-snug',
                    item.id === rail.activeId ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {railItemLabel(item)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  )
}
