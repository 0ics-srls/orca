import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  searchSessionService,
  sessionSearchServiceStatus
} from '../ai-vault-search/session-search-service-registry'
import {
  createSessionSearchClient,
  unavailableSessionSearchStatus
} from '../../shared/ai-vault-search-client'
import { AiVaultSearchRequestSchema } from '../../shared/ai-vault-search-contract'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../shared/ai-vault-search-types'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ParsedExecutionHost
} from '../../shared/execution-host'
import { getActiveSshAiVaultHostInfos, requestActiveSshSessionSearch } from './ssh'
import type { RuntimeAiVaultHostInfo } from './ai-vault-runtime-scan'
import { AI_VAULT_ALL_HOST_TIMEOUT_MS } from './ai-vault-all-host-timeouts'
import {
  searchAllExecutionHosts,
  withSearchExecutionHost,
  type SessionSearchHostLeg
} from './ai-vault-search-all-hosts'

export type RuntimeSessionSearchCall = (
  environmentId: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number
) => Promise<unknown>

export type AiVaultSearchHandlerOptions = {
  getActiveRuntimeAiVaultHostInfos?: () => readonly RuntimeAiVaultHostInfo[]
  callRuntimeSearch?: RuntimeSessionSearchCall
}

// One wording with the session list, which refuses the same unroutable scope.
const UNROUTABLE_HOST_MESSAGE = 'Agent Session History is not available for this execution host.'
const scopeSchema = z.string().min(1).optional()

type RequestedSearchScope = typeof ALL_EXECUTION_HOSTS_SCOPE | ParsedExecutionHost

let handlerOptions: AiVaultSearchHandlerOptions = {}

export function registerAiVaultSearchHandlers(options: AiVaultSearchHandlerOptions = {}): void {
  handlerOptions = options
  // Async so a refused scope reaches the renderer as a rejection, like every other parse failure.
  ipcMain.handle('aiVault:searchSessions', async (_event, raw: unknown, rawScope?: unknown) => {
    const scope = requestedSearchScope(rawScope)
    return searchByExecutionHostScope(AiVaultSearchRequestSchema.parse(raw), scope)
  })
  ipcMain.handle('aiVault:searchStatus', async (_event, rawScope?: unknown) => {
    const scope = requestedSearchScope(rawScope)
    // Status describes one index; there is nothing to merge across hosts.
    if (scope === ALL_EXECUTION_HOSTS_SCOPE) {
      throw new Error(UNROUTABLE_HOST_MESSAGE)
    }
    return statusByExecutionHost(scope)
  })
}

/**
 * Why not the list's `requestedExecutionHostScope`: it normalizes an unparseable
 * id to `all`, which would answer an unroutable request by searching every host.
 * Same parser, same omitted-means-this-host rule, but garbage is refused.
 */
function requestedSearchScope(raw: unknown): RequestedSearchScope {
  const value = scopeSchema.parse(raw)
  if (value === undefined) {
    return { kind: 'local', id: LOCAL_EXECUTION_HOST_ID }
  }
  if (value === ALL_EXECUTION_HOSTS_SCOPE) {
    return ALL_EXECUTION_HOSTS_SCOPE
  }
  const parsed = parseExecutionHostId(value)
  if (!parsed) {
    throw new Error(UNROUTABLE_HOST_MESSAGE)
  }
  return parsed
}

async function searchByExecutionHostScope(
  request: AiVaultSearchRequest,
  scope: RequestedSearchScope
): Promise<AiVaultSearchResponse> {
  if (scope === ALL_EXECUTION_HOSTS_SCOPE) {
    return searchAllExecutionHosts(request, allExecutionHostLegs())
  }
  if (scope.kind === 'local') {
    return searchSessionService(request, 'ipc')
  }
  const client = remoteSearchClient(scope, handlerOptions.callRuntimeSearch)
  if (!client) {
    return { kind: 'unavailable', reason: 'no-service' }
  }
  return withSearchExecutionHost(await client.searchSessions(request), scope.id)
}

function statusByExecutionHost(scope: ParsedExecutionHost): Promise<AiVaultSearchStatus> {
  if (scope.kind === 'local') {
    return sessionSearchServiceStatus({}, 'ipc')
  }
  const client = remoteSearchClient(scope, handlerOptions.callRuntimeSearch)
  return client ? client.searchStatus() : Promise.resolve(unavailableSessionSearchStatus())
}

// Null for the local host and for a runtime environment with no injected transport.
function remoteSearchClient(
  host: ParsedExecutionHost,
  call: RuntimeSessionSearchCall | undefined,
  timeoutMs?: number
): ReturnType<typeof createSessionSearchClient> | null {
  if (host.kind === 'ssh') {
    const { targetId } = host
    return createSessionSearchClient(
      (method, params) => requestActiveSshSessionSearch(targetId, method, params),
      'relay'
    )
  }
  if (host.kind === 'runtime' && call) {
    const { environmentId } = host
    return createSessionSearchClient(
      (method, params) => call(environmentId, method, params, timeoutMs),
      'relay'
    )
  }
  return null
}

function allExecutionHostLegs(): SessionSearchHostLeg[] {
  const call = handlerOptions.callRuntimeSearch
  return [
    {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      search: (request) => searchSessionService(request, 'ipc')
    },
    ...activeRemoteSearchHosts().flatMap((host) => {
      const client = remoteSearchClient(host, call, AI_VAULT_ALL_HOST_TIMEOUT_MS.search)
      return client
        ? [
            {
              executionHostId: host.id,
              timeoutMs: AI_VAULT_ALL_HOST_TIMEOUT_MS.search,
              search: (request: AiVaultSearchRequest) => client.searchSessions(request)
            }
          ]
        : []
    })
  ]
}

// Enumerating live SSH sessions can throw; that must cost those hosts, not the merge.
function activeRemoteSearchHosts(): ParsedExecutionHost[] {
  let sshTargetIds: readonly string[] = []
  try {
    sshTargetIds = getActiveSshAiVaultHostInfos().map((hostInfo) => hostInfo.targetId)
  } catch (error) {
    console.error('[ai-vault-search] SSH host enumeration failed:', error)
  }
  return [
    ...sshTargetIds.map((targetId) => ({
      kind: 'ssh' as const,
      id: toSshExecutionHostId(targetId),
      targetId
    })),
    ...(handlerOptions.getActiveRuntimeAiVaultHostInfos?.() ?? []).map((hostInfo) => ({
      kind: 'runtime' as const,
      id: hostInfo.executionHostId,
      environmentId: hostInfo.environmentId
    }))
  ]
}
