// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchResults } from '../../../../shared/ai-vault-search-test-fixture'
import { getExecutionHostLabel } from '../../../../shared/execution-host'
import { AiVaultPanelSearch } from './AiVaultPanelSearch'
import type { useAiVaultPanelSearch } from './use-ai-vault-search'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

afterEach(cleanup)

type PanelSearch = ReturnType<typeof useAiVaultPanelSearch>

function panelSearch(overrides: Partial<PanelSearch> = {}): PanelSearch {
  return {
    hits: [],
    response: null,
    needsUpdate: false,
    error: false,
    loading: false,
    removeHit: vi.fn(),
    retry: vi.fn(),
    loadMore: vi.fn(),
    onDeleted: vi.fn(),
    sessions: [],
    searchHits: new Map(),
    searching: true,
    localConsent: false,
    host: null,
    resetKey: 'all',
    ...overrides
  }
}

function renderPanel(search: PanelSearch) {
  return render(
    <AiVaultPanelSearch search={search} noAgents={false} onDismiss={vi.fn()}>
      <div>results</div>
    </AiVaultPanelSearch>
  )
}

describe('AiVaultPanelSearch', () => {
  it('names every computer the merge could not search, with its reason', () => {
    const response = searchResults()
    renderPanel(
      panelSearch({
        hits: response.hits,
        response: {
          ...response,
          hosts: [
            { executionHostId: 'local', outcome: 'disabled' },
            { executionHostId: 'ssh:build-box', outcome: 'unreachable' },
            { executionHostId: 'runtime:cloud', outcome: 'searched' },
            { executionHostId: 'runtime:paused', outcome: 'not-ready' },
            { executionHostId: 'ssh:moved', outcome: 'stale' },
            { executionHostId: 'ssh:old', outcome: 'no-service' }
          ]
        }
      })
    )

    expect(screen.getByRole('status').textContent).toBe(
      `Not searched: ${getExecutionHostLabel('local')} (search off) · build-box (unreachable) · paused (not ready) · moved (index changed) · old (unavailable)`
    )
  })

  it('tells the user a computer needs an update instead of showing its unscoped hits', () => {
    renderPanel(panelSearch({ needsUpdate: true, response: { ...searchResults(), hits: [] } }))

    expect(screen.getByRole('status').textContent).toContain('needs an Orca update')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('says a computer does not have this workspace or project rather than blaming the search', () => {
    renderPanel(panelSearch({ response: { kind: 'unavailable', reason: 'scope-unknown' } }))

    expect(screen.getByRole('status').textContent).toContain(
      'does not have this workspace or project'
    )
  })

  it('names a computer skipped for the scope or for its version in a merge', () => {
    const response = searchResults()
    renderPanel(
      panelSearch({
        hits: response.hits,
        response: {
          ...response,
          hosts: [
            { executionHostId: 'ssh:box', outcome: 'scope-unknown' },
            { executionHostId: 'runtime:old', outcome: 'needs-update' }
          ]
        }
      })
    )

    expect(screen.getByRole('status').textContent).toBe(
      'Not searched: box (scope not found there) · old (needs an update)'
    )
  })

  it('stays silent when every computer answered', () => {
    const response = searchResults()
    renderPanel(
      panelSearch({
        hits: response.hits,
        response: {
          ...response,
          hosts: [{ executionHostId: 'local', outcome: 'searched' }]
        }
      })
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('results')).toBeTruthy()
  })

  it('no longer asks the user to choose one computer before searching', () => {
    renderPanel(panelSearch({ host: null }))

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/choose one computer/i)).toBeNull()
    expect(screen.getByText('results')).toBeTruthy()
  })
})
