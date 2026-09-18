import { afterEach, describe, expect, it } from 'vitest'
import { fakeSearchService } from '../../shared/ai-vault-search-test-fixture'
import { unavailableSessionSearchStatus } from '../../shared/ai-vault-search-client'
import {
  installSessionSearchScopeCatalogSource,
  resetSessionSearchScopeCatalogForTests
} from './session-search-scope-catalog'
import { searchSessionService, setSessionSearchService } from './session-search-service-registry'

const CATALOG = {
  repos: [{ id: 'repo-1', path: '/work/app' }],
  projects: [],
  projectHostSetups: [],
  worktreeMeta: { 'repo-1::/work/app': {} },
  settings: { workspaceDir: '/home/me/orca/workspaces', nestWorkspaces: true }
}

afterEach(() => {
  setSessionSearchService(null)
  resetSessionSearchScopeCatalogForTests()
})

describe('scope identity at the search choke point', () => {
  it('narrows to the host’s own paths and acknowledges the scope it resolved', async () => {
    const service = fakeSearchService()
    setSessionSearchService(service)
    installSessionSearchScopeCatalogSource(() => CATALOG)
    const response = await searchSessionService(
      { query: 'needle', within: { kind: 'workspace', worktreeId: 'repo-1::/work/app' } },
      'ipc'
    )
    expect(service.search).toHaveBeenCalledWith({
      query: 'needle',
      limit: 20,
      filters: { scopePaths: ['/work/app'] }
    })
    expect(response).toMatchObject({ resolvedWithin: { kind: 'workspace', paths: 1 } })
  })

  it('never forwards the identity to the engine, which only knows paths', async () => {
    const service = fakeSearchService()
    setSessionSearchService(service)
    installSessionSearchScopeCatalogSource(() => CATALOG)
    await searchSessionService(
      { query: 'needle', within: { kind: 'project', projectKey: 'repo:repo-1' } },
      'ipc'
    )
    // An exact match, so a leaked `within` would fail here as an extra key.
    expect(service.search).toHaveBeenCalledWith({
      query: 'needle',
      limit: 20,
      filters: { scopePaths: ['/work/app', '/home/me/orca/workspaces/app'] }
    })
  })

  it('answers scope-unknown rather than searching everything it has', async () => {
    const service = fakeSearchService()
    setSessionSearchService(service)
    installSessionSearchScopeCatalogSource(() => CATALOG)
    expect(
      await searchSessionService(
        { query: 'needle', within: { kind: 'project', projectKey: 'repo:elsewhere' } },
        'ipc'
      )
    ).toEqual({ kind: 'unavailable', reason: 'scope-unknown' })
    expect(service.search).not.toHaveBeenCalled()
  })

  it('reports being switched off ahead of a scope it could never have resolved', async () => {
    const service = fakeSearchService()
    service.status.mockResolvedValue({ ...unavailableSessionSearchStatus(), enabled: false })
    setSessionSearchService(service)
    // No catalog: every host without a profile store, the relay included.
    expect(
      await searchSessionService(
        { query: 'needle', within: { kind: 'workspace', worktreeId: 'repo-1::/work/app' } },
        'ipc'
      )
    ).toEqual({ kind: 'unavailable', reason: 'disabled' })
  })

  it('leaves an unscoped search unnarrowed and unacknowledged', async () => {
    const service = fakeSearchService()
    setSessionSearchService(service)
    installSessionSearchScopeCatalogSource(() => CATALOG)
    const response = await searchSessionService({ query: 'needle' }, 'ipc')
    expect(service.search).toHaveBeenCalledWith({ query: 'needle', limit: 20 })
    expect(response).not.toHaveProperty('resolvedWithin')
  })

  it('still honours an explicit path filter, which is what the CLI’s --path sends', async () => {
    const service = fakeSearchService()
    setSessionSearchService(service)
    installSessionSearchScopeCatalogSource(() => CATALOG)
    await searchSessionService({ query: 'needle', filters: { scopePaths: ['/other'] } }, 'ipc')
    expect(service.search).toHaveBeenCalledWith({
      query: 'needle',
      limit: 20,
      filters: { scopePaths: ['/other'] }
    })
  })
})
