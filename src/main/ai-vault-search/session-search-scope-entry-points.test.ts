import { afterEach, describe, expect, it } from 'vitest'
import { AiVaultHandler } from '../../relay/ai-vault-handler'
import type { RelayDispatcher } from '../../relay/dispatcher'
import { createSessionSearchClient } from '../../shared/ai-vault-search-client'
import { fakeSearchService } from '../../shared/ai-vault-search-test-fixture'
import { searchAllExecutionHosts } from '../ipc/ai-vault-search-all-hosts'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { AI_VAULT_METHODS } from '../runtime/rpc/methods/ai-vault'
import {
  installSessionSearchScopeCatalogSource,
  resetSessionSearchScopeCatalogForTests
} from './session-search-scope-catalog'
import { searchSessionService, setSessionSearchService } from './session-search-service-registry'

const CATALOG = {
  repos: [{ id: 'repo-1', path: '/work/app' }],
  projects: [],
  projectHostSetups: [],
  worktreeMeta: {},
  settings: { workspaceDir: '/home/me/orca/workspaces', nestWorkspaces: true }
}
const WITHIN = { kind: 'workspace', worktreeId: 'repo-1::/work/app' } as const

afterEach(() => {
  setSessionSearchService(null)
  resetSessionSearchScopeCatalogForTests()
})

function relayHandler(): (params: Record<string, unknown>) => Promise<unknown> {
  const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
  const dispatcher = {
    onRequest: (method: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers.set(method, handler)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls `onRequest`, and the test asserts the registration it makes.
  new AiVaultHandler(dispatcher as unknown as RelayDispatcher)
  const search = handlers.get('aiVault.searchSessions')
  if (!search) {
    throw new Error('relay registered no session search handler')
  }
  return search
}

describe('every search entry point carries the scope identity through', () => {
  it('resolves and acknowledges over the in-process IPC entry point', async () => {
    setSessionSearchService(fakeSearchService())
    installSessionSearchScopeCatalogSource(() => CATALOG)
    expect(await searchSessionService({ query: 'needle', within: WITHIN }, 'ipc')).toMatchObject({
      resolvedWithin: { kind: 'workspace', paths: 1 }
    })
  })

  it('resolves and acknowledges over the runtime RPC method', async () => {
    setSessionSearchService(fakeSearchService())
    installSessionSearchScopeCatalogSource(() => CATALOG)
    const rpc = new RpcDispatcher({
      runtime: new OrcaRuntimeService(),
      methods: AI_VAULT_METHODS
    })
    expect(
      await rpc.dispatch({
        id: 'search-1',
        authToken: 'test',
        method: 'aiVault.searchSessions',
        params: { query: 'needle', within: WITHIN }
      })
    ).toMatchObject({ ok: true, result: { resolvedWithin: { kind: 'workspace', paths: 1 } } })
  })

  it('resolves and acknowledges over the relay entry point', async () => {
    setSessionSearchService(fakeSearchService())
    installSessionSearchScopeCatalogSource(() => CATALOG)
    expect(await relayHandler()({ query: 'needle', within: WITHIN })).toMatchObject({
      resolvedWithin: { kind: 'workspace', paths: 1 }
    })
  })

  it('answers scope-unknown over the relay, which carries no repo catalog of its own', async () => {
    const service = fakeSearchService()
    service.status.mockResolvedValue({ ...(await service.status()), enabled: true })
    setSessionSearchService(service)
    expect(await relayHandler()({ query: 'needle', within: WITHIN })).toEqual({
      kind: 'unavailable',
      reason: 'scope-unknown'
    })
  })
})

describe('the shared remote client', () => {
  it('carries the identity out and the acknowledgement back across a transport', async () => {
    setSessionSearchService(fakeSearchService())
    installSessionSearchScopeCatalogSource(() => CATALOG)
    const client = createSessionSearchClient(
      (_method, params) => searchSessionService(params, 'relay'),
      'relay'
    )
    expect(await client.searchSessions({ query: 'needle', within: WITHIN })).toMatchObject({
      resolvedWithin: { kind: 'workspace', paths: 1 }
    })
  })
})

describe('an all-computers merge across mixed host versions', () => {
  it('drops an old host’s unscoped hits and names it as needing an update', async () => {
    const response = await searchAllExecutionHosts({ query: 'needle', within: WITHIN }, [
      {
        executionHostId: 'local',
        search: async () => ({
          kind: 'results',
          hits: [],
          page: { cursor: null, hasMore: false },
          generation: 1,
          truncated: { candidates: false, snippets: 0, query: false, freshness: false },
          durationMs: 1,
          resolvedWithin: { kind: 'workspace', paths: 1 }
        })
      },
      {
        executionHostId: 'runtime:old',
        // An old host ignores `within` and answers with everything it has.
        search: async () => ({
          kind: 'results',
          hits: [
            {
              agent: 'claude',
              sessionId: 'elsewhere',
              title: 'another project',
              cwd: '/other',
              branch: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
              messageCount: 1,
              score: 1,
              source: { presence: 'present' },
              evidence: null
            }
          ],
          page: { cursor: null, hasMore: false },
          generation: 1,
          truncated: { candidates: false, snippets: 0, query: false, freshness: false },
          durationMs: 1
        })
      },
      {
        executionHostId: 'ssh:box',
        search: async () => ({ kind: 'unavailable', reason: 'scope-unknown' })
      }
    ])
    if (response.kind !== 'results') {
      throw new Error('Expected merged results')
    }
    expect(response.hits).toEqual([])
    expect(response.hosts).toEqual([
      { executionHostId: 'local', outcome: 'searched' },
      { executionHostId: 'runtime:old', outcome: 'needs-update' },
      { executionHostId: 'ssh:box', outcome: 'scope-unknown' }
    ])
  })
})
