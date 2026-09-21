import type React from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { AiVaultSortOption } from './ai-vault-sort-options'

/** Left-hand label while searching: how many hits the list is showing. */
export function AiVaultResultCountLabel({ count }: { count: number }): React.JSX.Element {
  return (
    <>
      {count === 1
        ? translate('sessionSearch.panel.resultsOne', '{{count}} result', { count })
        : translate('sessionSearch.panel.resultsOther', '{{count}} results', { count })}
    </>
  )
}

/** Left-hand label while browsing: how much of the scanned history the list is showing. */
export function AiVaultShownCountLabel({
  shown,
  recent
}: {
  shown: number
  recent: number
}): React.JSX.Element {
  return (
    <>
      {/* Why: below 300px the bar competes with the sort menu, so compact copy prevents overlap. */}
      <span className="@max-[300px]/ai-vault:hidden">
        {translate(
          'auto.components.right.sidebar.AiVaultPanel.shownRecent',
          '{{value0}} shown · {{value1}} recent',
          { value0: shown, value1: recent }
        )}
      </span>
      <span className="hidden @max-[300px]/ai-vault:inline">
        {translate(
          'auto.components.right.sidebar.AiVaultPanel.sessionsShownCompact',
          '{{value0}} shown',
          { value0: shown }
        )}
      </span>
    </>
  )
}

/**
 * The bar above the session list: what the list is showing on the left, the order that
 * produced it on the right — the one place sort is both reported and changed.
 */
export function AiVaultSessionListBar<Value extends string>({
  label,
  value,
  options,
  sortAriaLabel,
  onChange
}: {
  label: ReactNode
  value: Value
  options: readonly AiVaultSortOption<Value>[]
  sortAriaLabel: (selectedLabel: string) => string
  onChange: (value: Value) => void
}): React.JSX.Element {
  const selected = options.find((option) => option.value === value)
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-y border-sidebar-border bg-sidebar-accent/60 pl-3 pr-1.5">
      <span className="min-w-0 flex-1 truncate text-xs font-semibold tabular-nums text-foreground">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            aria-label={sortAriaLabel(selected?.label ?? '')}
          >
            {selected?.label}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={value}
            // Radix hands back a bare string; the option list is what narrows it.
            onValueChange={(next) => {
              const picked = options.find((option) => option.value === next)
              if (picked) {
                onChange(picked.value)
              }
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
