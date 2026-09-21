import { translate } from '@/i18n/i18n'
import type { AiVaultSearchSort, AiVaultSort } from '../../../../shared/ai-vault-types'

export type AiVaultSortOption<Value extends string> = { value: Value; label: string }

export function aiVaultBrowseSortOptions(): readonly AiVaultSortOption<AiVaultSort>[] {
  return [
    {
      value: 'updated',
      label: translate(
        'auto.components.right.sidebar.AiVaultPanelControls.lastUpdated',
        'Last updated'
      )
    },
    {
      value: 'created',
      label: translate('auto.components.right.sidebar.AiVaultPanelControls.created', 'Created')
    }
  ]
}

export function aiVaultSearchSortOptions(): readonly AiVaultSortOption<AiVaultSearchSort>[] {
  return [
    { value: 'relevance', label: translate('sessionSearch.panel.sortRelevance', 'Most relevant') },
    { value: 'newest', label: translate('sessionSearch.panel.sortNewest', 'Newest') }
  ]
}

export function aiVaultBrowseSortAriaLabel(selectedLabel: string): string {
  return translate('sessionSearch.panel.sortSessionsAriaLabel', 'Sort sessions: {{value0}}', {
    value0: selectedLabel
  })
}

export function aiVaultSearchSortAriaLabel(selectedLabel: string): string {
  return translate('sessionSearch.panel.sortResultsAriaLabel', 'Sort results: {{value0}}', {
    value0: selectedLabel
  })
}
