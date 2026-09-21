import type React from 'react'
import { Calendar, Clock3, Sparkles } from 'lucide-react'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { AiVaultSearchSort, AiVaultSort } from '../../../../shared/ai-vault-types'
import { isAiVaultSearchSort, isAiVaultSort } from './ai-vault-view-options-persistence'

/** The Sort choices in the view menu: the index's orders while the box has text, the list's otherwise. */
export function VaultSortRadioGroup({
  searching,
  sort,
  searchSort,
  onSortChange,
  onSearchSortChange
}: {
  searching: boolean
  sort: AiVaultSort
  searchSort: AiVaultSearchSort
  onSortChange: (sort: AiVaultSort) => void
  onSearchSortChange: (sort: AiVaultSearchSort) => void
}): React.JSX.Element {
  if (searching) {
    return (
      <DropdownMenuRadioGroup
        value={searchSort}
        onValueChange={(value) => isAiVaultSearchSort(value) && onSearchSortChange(value)}
      >
        <DropdownMenuRadioItem value="relevance">
          <Sparkles className="size-3.5" />
          {translate('sessionSearch.panel.sortRelevance', 'Most relevant')}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="newest">
          <Clock3 className="size-3.5" />
          {translate('sessionSearch.panel.sortNewest', 'Newest')}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    )
  }
  return (
    <DropdownMenuRadioGroup
      value={sort}
      onValueChange={(value) => isAiVaultSort(value) && onSortChange(value)}
    >
      <DropdownMenuRadioItem value="updated">
        <Clock3 className="size-3.5" />
        {translate(
          'auto.components.right.sidebar.AiVaultPanelControls.lastUpdated',
          'Last updated'
        )}
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="created">
        <Calendar className="size-3.5" />
        {translate('auto.components.right.sidebar.AiVaultPanelControls.created', 'Created')}
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )
}
