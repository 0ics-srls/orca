import type React from 'react'
import { ChevronDown, Clock3, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { AiVaultSearchSort } from '../../../../shared/ai-vault-types'
import { isAiVaultSearchSort } from './ai-vault-view-options-persistence'

function relevanceLabel(): string {
  return translate('sessionSearch.panel.sortRelevance', 'Most relevant')
}

function newestLabel(): string {
  return translate('sessionSearch.panel.sortNewest', 'Newest')
}

function resultCountLabel(count: number): string {
  return count === 1
    ? translate('sessionSearch.panel.resultsOne', '{{count}} result', { count })
    : translate('sessionSearch.panel.resultsOther', '{{count}} results', { count })
}

/**
 * Search mode's stand-in for the group header: how many hits are shown, and the
 * order that produced them — the one place sort is both reported and changed.
 */
export function AiVaultSearchResultsBar({
  count,
  sort,
  onSortChange
}: {
  count: number
  sort: AiVaultSearchSort
  onSortChange: (sort: AiVaultSearchSort) => void
}): React.JSX.Element {
  const newest = sort === 'newest'
  const SortIcon = newest ? Clock3 : Sparkles
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-y border-sidebar-border bg-sidebar-accent/60 pl-3 pr-1.5">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums text-foreground">
        {resultCountLabel(count)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            aria-label={translate(
              'sessionSearch.panel.sortResultsAriaLabel',
              'Sort results: {{value0}}',
              { value0: newest ? newestLabel() : relevanceLabel() }
            )}
          >
            <SortIcon />
            {newest ? newestLabel() : relevanceLabel()}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => isAiVaultSearchSort(value) && onSortChange(value)}
          >
            <DropdownMenuRadioItem value="relevance">
              <Sparkles className="size-3.5" />
              {relevanceLabel()}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="newest">
              <Clock3 className="size-3.5" />
              {newestLabel()}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
