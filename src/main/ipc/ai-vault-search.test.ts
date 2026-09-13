import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, sshSearch, sshHostInfos, runtimeSearch, runtimeHostInfos } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  sshSearch: vi.fn(),
  sshHostInfos: vi.fn<() => { targetId: string }[]>(() => []),
  runtimeSearch: vi.fn(),
  runtimeHostInfos: vi.fn<() => { environmentId: string; executionHostId: `runtime:${string}` }[]>(
    () => []
  )
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(name, handler)
  },
  ipcRenderer: { invoke: (name: string, ...args: unknown[]) => handlers.get(name)!(null, ...args) }
}))
vi.mock('./ssh', () => ({
  requestActiveSshSessionSearch: sshSearch,
  getActiveSshAiVaultHostInfos: sshHostInfos
}))

import { registerAiVaultSearchHandlers } from './ai-vault-search'
import { decodeMergedSearchCursor } from './ai-vault-search-all-hosts'
import { aiVaultApi } from '../../preload/api/ai-vault-bridge'
import { setSessionSearchService } from '../ai-vault-search/session-search-service-registry'
import { unavailableSessionSearchStatus } from '../../shared/ai-vault-search-client'
import {
  fakeSearchService,
  searchHit,
  searchResults
} from '../../shared/ai-vault-search-test-fixture'
import type { AiVaultSearchResponse } from '../../shared/ai-vault-search-types'

function resultsAt(
  updatedAt: string | null,
  page: { cursor: string | null; hasMore: boolean } = { cursor: null, hasMore: false }
) {
  return { ...searchResults(), hits: [{ ...searchHit(), updatedAt }], page }
}

function serviceReturning(response: AiVaultSearchResponse) {
  return { ...fakeSearchService(), search: vi.fn(async () => response) }
}

function updatedAtOf(response: AiVaultSearchResponse): (string | null)[] {
  return response.kind === 'results' ? response.hits.map((hit) => hit.updatedAt) : []
}

beforeEach(() => {
  handlers.clear()
  sshSearch.mockReset()
  runtimeSearch.mockReset()
  sshHostInfos.mockReset().mockReturnValue([])
  runtimeHostInfos.mockReset().mockReturnValue([])
  registerAiVaultSearchHandlers({
    getActiveRuntimeAiVaultHostInfos: runtimeHostInfos,
    callRuntimeSearch: runtimeSearch
  })
})
afterEach(() => setSessionSearchService(null))

describe('desktop IPC and preload search boundary', () => {
  it('round-trips local results and separate status through the actual preload', async () => {
    setSessionSearchService(fakeSearchService())
    expect(await aiVaultApi.searchSessions({ query: 'needle' })).toMatchObject({
      kind: 'results',
      hits: [
        {
          source: { presence: 'present', filePath: '/host/transcript.jsonl' },
          resumeCommand: 'host-resume-command'
        }
      ]
    })
    expect(await aiVaultApi.searchSessions({ query: 'needle' }, 'local')).toMatchObject({
      hits: [{ source: { filePath: '/host/transcript.jsonl' } }]
    })
    expect(await aiVaultApi.searchStatus()).toMatchObject({ enabled: true, generation: 7 })
    expect(sshSearch).not.toHaveBeenCalled()
    expect(runtimeSearch).not.toHaveBeenCalled()
  })
  it('rejects malformed renderer input and uses typed unavailable', async () => {
    expect(await aiVaultApi.searchSessions({ query: 'needle' })).toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    await expect(handlers.get('aiVault:searchSessions')!(null, { query: 1 })).rejects.toThrow()
    await expect(handlers.get('aiVault:searchStatus')!(null, 42)).rejects.toThrow()
  })
  it('routes one SSH target without touching the local index and redacts received paths', async () => {
    const local = fakeSearchService()
    setSessionSearchService(local)
    sshSearch.mockResolvedValue(searchResults())
    const result = await aiVaultApi.searchSessions({ query: 'needle' }, 'ssh:ssh-host')
    expect(sshSearch).toHaveBeenCalledWith('ssh-host', 'aiVault.searchSessions', {
      query: 'needle',
      limit: 20
    })
    expect(result).toMatchObject({
      hits: [{ executionHostId: 'ssh:ssh-host', source: { presence: 'present' } }]
    })
    expect(JSON.stringify(result)).not.toContain('resumeCommand')
    expect(local.search).not.toHaveBeenCalled()
    sshSearch.mockRejectedValue(new Error('SSH relay is not ready'))
    await expect(aiVaultApi.searchSessions({ query: 'needle' }, 'ssh:ssh-host')).rejects.toThrow(
      'SSH relay is not ready'
    )
    expect(local.search).not.toHaveBeenCalled()
  })
  it('routes one runtime environment over its RPC and stamps the answering host', async () => {
    const local = fakeSearchService()
    setSessionSearchService(local)
    runtimeSearch.mockResolvedValue(searchResults())
    const result = await aiVaultApi.searchSessions({ query: 'needle' }, 'runtime:env-1')
    expect(runtimeSearch).toHaveBeenCalledWith(
      'env-1',
      'aiVault.searchSessions',
      { query: 'needle', limit: 20 },
      undefined
    )
    expect(result).toMatchObject({
      hits: [{ executionHostId: 'runtime:env-1', source: { presence: 'present' } }]
    })
    expect(JSON.stringify(result)).not.toContain('/host/transcript.jsonl')
    expect(local.search).not.toHaveBeenCalled()
    runtimeSearch.mockResolvedValue(unavailableSessionSearchStatus())
    expect(await aiVaultApi.searchStatus('runtime:env-1')).toEqual(unavailableSessionSearchStatus())
    expect(runtimeSearch).toHaveBeenLastCalledWith('env-1', 'aiVault.searchStatus', {}, undefined)
  })
  it('maps a runtime unknown-method refusal to unavailable and keeps transport errors', async () => {
    runtimeSearch.mockRejectedValue(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )
    expect(await aiVaultApi.searchSessions({ query: 'needle' }, 'runtime:env-1')).toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    runtimeSearch.mockRejectedValue(
      Object.assign(new Error('runtime disconnected'), { code: 'connection_lost' })
    )
    await expect(aiVaultApi.searchSessions({ query: 'needle' }, 'runtime:env-1')).rejects.toThrow(
      'runtime disconnected'
    )
  })
  it('reports unavailable when no runtime transport is injected', async () => {
    handlers.clear()
    registerAiVaultSearchHandlers()
    expect(await aiVaultApi.searchSessions({ query: 'needle' }, 'runtime:env-1')).toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    expect(await aiVaultApi.searchStatus('runtime:env-1')).toMatchObject({
      enabled: false,
      phase: 'idle'
    })
  })
  it('refuses an unroutable host instead of widening it to every host', async () => {
    setSessionSearchService(fakeSearchService())
    for (const scope of ['nope', 'ssh:', 'runtime:a|b']) {
      await expect(
        handlers.get('aiVault:searchSessions')!(null, { query: 'needle' }, scope)
      ).rejects.toThrow('not available for this execution host')
      await expect(handlers.get('aiVault:searchStatus')!(null, scope)).rejects.toThrow(
        'not available for this execution host'
      )
    }
    // Status describes one index, so the everything-scope is not routable either.
    await expect(handlers.get('aiVault:searchStatus')!(null, 'all')).rejects.toThrow(
      'not available for this execution host'
    )
  })
})

// Serves `pages` in order; page N+1 is addressed by the cursor page N handed back.
function pagedHost(key: string, pages: (string | null)[][]) {
  return (cursor: string | undefined): AiVaultSearchResponse => {
    const index = cursor === undefined ? 0 : Number(cursor.slice(`${key}-p`.length))
    const hasMore = index + 1 < pages.length
    return {
      ...searchResults(),
      hits: (pages[index] ?? []).map((updatedAt) => ({ ...searchHit(), updatedAt })),
      page: { cursor: hasMore ? `${key}-p${index + 1}` : null, hasMore }
    }
  }
}

function pagedService(responder: (cursor: string | undefined) => AiVaultSearchResponse) {
  return { ...fakeSearchService(), search: vi.fn(async (request) => responder(request.cursor)) }
}

function mergedCursorOf(response: AiVaultSearchResponse) {
  const cursor = response.kind === 'results' ? response.page.cursor : null
  return cursor === null ? null : decodeMergedSearchCursor(cursor)
}

describe('all-hosts search fan-out', () => {
  beforeEach(() => {
    sshHostInfos.mockReturnValue([{ targetId: 'ssh-host' }])
    runtimeHostInfos.mockReturnValue([{ environmentId: 'env-1', executionHostId: 'runtime:env-1' }])
  })

  it('merges every host by recency, keeps local paths and withholds remote ones', async () => {
    setSessionSearchService(serviceReturning(resultsAt('2026-01-02T00:00:00.000Z')))
    sshSearch.mockResolvedValue(resultsAt('2026-01-03T00:00:00.000Z'))
    runtimeSearch.mockResolvedValue(resultsAt(null))
    const result = await aiVaultApi.searchSessions({ query: 'needle' }, 'all')
    expect(result.kind).toBe('results')
    if (result.kind !== 'results') {
      return
    }
    expect(result.hits.map((hit) => hit.executionHostId)).toEqual([
      'ssh:ssh-host',
      'local',
      'runtime:env-1'
    ])
    expect(result.hosts).toEqual([
      { executionHostId: 'local', outcome: 'results' },
      { executionHostId: 'ssh:ssh-host', outcome: 'results' },
      { executionHostId: 'runtime:env-1', outcome: 'results' }
    ])
    expect(result.generation).toBe(7)
    expect(result.page).toEqual({ cursor: null, hasMore: false })
    expect(result.hits.find((hit) => hit.executionHostId === 'local')?.source).toEqual({
      presence: 'present',
      filePath: '/host/transcript.jsonl',
      codexHome: '/host/codex'
    })
    for (const hit of result.hits.filter((candidate) => candidate.executionHostId !== 'local')) {
      expect(hit.source).toEqual({ presence: 'present' })
    }
    expect(
      JSON.stringify(result.hits.filter((hit) => hit.executionHostId !== 'local'))
    ).not.toContain('/host/transcript.jsonl')
  })
  it('asks every leg for newest order and cuts the merge to the requested limit', async () => {
    setSessionSearchService(serviceReturning(resultsAt('2026-01-02T00:00:00.000Z')))
    sshSearch.mockResolvedValue(resultsAt('2026-01-03T00:00:00.000Z'))
    runtimeSearch.mockResolvedValue(resultsAt('2026-01-01T00:00:00.000Z'))
    const result = await aiVaultApi.searchSessions(
      { query: 'needle', limit: 2, filters: { sort: 'relevance' } },
      'all'
    )
    expect(updatedAtOf(result)).toEqual(['2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'])
    expect(sshSearch).toHaveBeenCalledWith('ssh-host', 'aiVault.searchSessions', {
      query: 'needle',
      limit: 2,
      filters: { sort: 'newest' }
    })
  })

  describe('a lagging host whose page-1 hits all lose the first cut', () => {
    let local: ReturnType<typeof pagedService>

    beforeEach(() => {
      runtimeHostInfos.mockReturnValue([])
      // Every hit host A holds is older than both of host B's first-page hits.
      local = pagedService(
        pagedHost('local', [['2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z']])
      )
      setSessionSearchService(local)
      const ssh = pagedHost('ssh', [
        ['2026-01-05T00:00:00.000Z', '2026-01-04T00:00:00.000Z'],
        ['2026-01-03T00:00:00.000Z']
      ])
      sshSearch.mockImplementation(async (_target, _method, params) => ssh(params.cursor))
    })

    it('surfaces every hit exactly once across pages, in global recency order', async () => {
      const seen: (string | null)[] = []
      let cursor: string | undefined
      for (let page = 0; page < 4; page += 1) {
        const result = await aiVaultApi.searchSessions({ query: 'needle', limit: 2, cursor }, 'all')
        seen.push(...updatedAtOf(result))
        cursor = result.kind === 'results' ? (result.page.cursor ?? undefined) : undefined
        if (!cursor) {
          break
        }
      }
      expect(cursor).toBeUndefined()
      expect(seen).toEqual([
        '2026-01-05T00:00:00.000Z',
        '2026-01-04T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      ])
    })
    it('records the unread page for one host and a mid-page skip for the other', async () => {
      const first = await aiVaultApi.searchSessions({ query: 'needle', limit: 2 }, 'all')
      expect(updatedAtOf(first)).toEqual(['2026-01-05T00:00:00.000Z', '2026-01-04T00:00:00.000Z'])
      // Host A emitted nothing yet, so it resumes at its first page with no skip.
      expect(mergedCursorOf(first)).toEqual({
        local: { c: null, e: 0 },
        'ssh:ssh-host': { c: 'ssh-p1', e: 0 }
      })

      const cursor = first.kind === 'results' ? first.page.cursor! : ''
      const second = await aiVaultApi.searchSessions({ query: 'needle', limit: 2, cursor }, 'all')
      expect(updatedAtOf(second)).toEqual(['2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'])
      expect(mergedCursorOf(second)).toEqual({ local: { c: null, e: 1 } })
      expect(local.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'needle', limit: 2 })
      )
      expect(sshSearch).toHaveBeenLastCalledWith(
        'ssh-host',
        'aiVault.searchSessions',
        expect.objectContaining({ cursor: 'ssh-p1' })
      )
    })
    it('reports a leg that goes stale mid-walk without losing the other host', async () => {
      const first = await aiVaultApi.searchSessions({ query: 'needle', limit: 2 }, 'all')
      sshSearch.mockResolvedValue({ kind: 'stale-cursor', generation: 9 })
      const cursor = first.kind === 'results' ? first.page.cursor! : ''
      const second = await aiVaultApi.searchSessions({ query: 'needle', limit: 2, cursor }, 'all')
      expect(second.kind === 'results' && second.hosts).toEqual([
        { executionHostId: 'local', outcome: 'results' },
        { executionHostId: 'ssh:ssh-host', outcome: 'stale-cursor' }
      ])
      expect(updatedAtOf(second)).toEqual(['2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'])
      // A refused cursor stays refused, so only the healthy host is left to resume.
      expect(mergedCursorOf(second)).toBeNull()
    })
  })

  it('bounds the pages one host contributes to a single merged request', async () => {
    sshHostInfos.mockReturnValue([])
    runtimeHostInfos.mockReturnValue([])
    const local = pagedService(
      pagedHost('local', [
        ['2026-01-05T00:00:00.000Z'],
        ['2026-01-04T00:00:00.000Z'],
        ['2026-01-03T00:00:00.000Z'],
        ['2026-01-02T00:00:00.000Z']
      ])
    )
    setSessionSearchService(local)
    const result = await aiVaultApi.searchSessions({ query: 'needle', limit: 20 }, 'all')
    expect(local.search).toHaveBeenCalledTimes(3)
    expect(updatedAtOf(result)).toHaveLength(3)
    expect(mergedCursorOf(result)).toEqual({ local: { c: 'local-p3', e: 0 } })
  })
  it('keeps a cursor for a host that has gone away rather than dropping its hits', async () => {
    sshHostInfos.mockReturnValue([])
    runtimeHostInfos.mockReturnValue([])
    setSessionSearchService(serviceReturning(resultsAt('2026-01-02T00:00:00.000Z')))
    const cursor = Buffer.from(
      JSON.stringify({ local: { c: null, e: 0 }, 'ssh:gone': { c: 'gone-p1', e: 2 } }),
      'utf8'
    ).toString('base64url')
    const result = await aiVaultApi.searchSessions({ query: 'needle', cursor }, 'all')
    expect(result.kind === 'results' && result.hosts).toEqual([
      { executionHostId: 'local', outcome: 'results' },
      { executionHostId: 'ssh:gone', outcome: 'unreachable' }
    ])
    expect(updatedAtOf(result)).toEqual(['2026-01-02T00:00:00.000Z'])
    expect(mergedCursorOf(result)).toEqual({ 'ssh:gone': { c: 'gone-p1', e: 2 } })
  })
  it('reports an unreachable first page without carrying it forward', async () => {
    setSessionSearchService(serviceReturning(resultsAt('2026-01-02T00:00:00.000Z')))
    sshSearch.mockRejectedValue(new Error('SSH relay is not ready'))
    runtimeSearch.mockRejectedValue(new Error('runtime disconnected'))
    const result = await aiVaultApi.searchSessions({ query: 'needle' }, 'all')
    expect(result.kind === 'results' && result.hosts).toEqual([
      { executionHostId: 'local', outcome: 'results' },
      { executionHostId: 'ssh:ssh-host', outcome: 'unreachable' },
      { executionHostId: 'runtime:env-1', outcome: 'unreachable' }
    ])
    expect(updatedAtOf(result)).toEqual(['2026-01-02T00:00:00.000Z'])
    expect(mergedCursorOf(result)).toBeNull()
  })
  it('refuses a merged cursor it did not mint', async () => {
    setSessionSearchService(serviceReturning(resultsAt(null)))
    expect(
      await aiVaultApi.searchSessions({ query: 'needle', cursor: 'not-a-map' }, 'all')
    ).toEqual({ kind: 'malformed-cursor' })
    const legacy = Buffer.from(JSON.stringify({ local: 'plain-cursor' }), 'utf8').toString(
      'base64url'
    )
    expect(await aiVaultApi.searchSessions({ query: 'needle', cursor: legacy }, 'all')).toEqual({
      kind: 'malformed-cursor'
    })
    expect(sshSearch).not.toHaveBeenCalled()
  })
})
