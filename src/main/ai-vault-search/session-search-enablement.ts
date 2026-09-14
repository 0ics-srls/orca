import {
  resolveAiVaultSearchSettings,
  sameAiVaultSearchSettings
} from '../../shared/ai-vault-search-settings'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { updateSessionSearchInService } from '../ai-vault/session-scanner-service-spawn'
import { createChildSessionSearchService } from './session-search-child-service'
import { installSessionSearchPolicySource } from './session-search-policy'
import { setSessionSearchService } from './session-search-service-registry'
import {
  installSessionSearchDataRoot,
  refreshSessionSearchScanRoots,
  sessionSearchServiceInit
} from './session-search-service-init'
import { sessionSearchSqliteAvailable } from './session-search-sqlite-support'
import { sameSessionSearchRoots, type SessionSearchScanRoots } from './session-search-scan-roots'

const ROOT_REFRESH_INTERVAL_MS = 5 * 60_000

type RootRefresh = {
  disposed: boolean
  timer: ReturnType<typeof setInterval> | null
  lastPushedRoots: SessionSearchScanRoots | null
}

let rootRefresh: RootRefresh | null = null

/**
 * The desktop's one wiring point: search answers from the scanner child, and the
 * child's consent comes from the settings store.
 *
 * Registered whether or not the setting is on, because "off" is an answer this
 * host can give (`unavailable/disabled`) and `no-service` is not — that reason
 * means nothing here owns an index, which stops being true the moment this runs.
 */
export function installChildSessionSearchService(args: {
  dataRoot: string
  getSettings: () => Pick<GlobalSettings, 'aiVaultSearch'>
}): { dispose(): void } | null {
  if (!sessionSearchSqliteAvailable()) {
    return null
  }
  const refresh: RootRefresh = {
    disposed: false,
    timer: null,
    lastPushedRoots: null
  }
  rootRefresh = refresh
  installSessionSearchDataRoot(args.dataRoot)
  installSessionSearchPolicySource(args.getSettings)
  setSessionSearchService(createChildSessionSearchService())
  void pushSessionSearchPolicy(refresh)
  return {
    dispose: () => {
      refresh.disposed = true
      if (refresh.timer) {
        clearInterval(refresh.timer)
      }
      if (rootRefresh === refresh) {
        rootRefresh = null
      }
    }
  }
}

/**
 * Reconciles a settings write. An unchanged policy is not forwarded, so re-saving
 * the same value never restarts a running index.
 */
export function applySessionSearchSettingsChange(
  before: Pick<GlobalSettings, 'aiVaultSearch'>,
  after: Pick<GlobalSettings, 'aiVaultSearch'>
): void {
  if (
    sameAiVaultSearchSettings(
      resolveAiVaultSearchSettings(before),
      resolveAiVaultSearchSettings(after)
    )
  ) {
    return
  }
  if (rootRefresh) {
    void pushSessionSearchPolicy(rootRefresh)
  }
}

function updateRootRefreshTimer(refresh: RootRefresh, enabled: boolean): void {
  if (!enabled) {
    if (refresh.timer) {
      clearInterval(refresh.timer)
    }
    refresh.timer = null
  } else if (!refresh.timer) {
    refresh.timer = setInterval(() => {
      void pushSessionSearchPolicy(refresh, false)
    }, ROOT_REFRESH_INTERVAL_MS)
    refresh.timer.unref()
  }
}

async function pushSessionSearchPolicy(refresh: RootRefresh, policyChanged = true): Promise<void> {
  try {
    const current = sessionSearchServiceInit()
    if (!current || refresh.disposed) {
      return
    }
    if (!current.settings.enabled) {
      updateRootRefreshTimer(refresh, false)
      if (policyChanged) {
        updateSessionSearchInService(current)
      }
      return
    }
    await refreshSessionSearchScanRoots()
    if (refresh.disposed) {
      return
    }
    const init = sessionSearchServiceInit()
    if (!init) {
      return
    }
    updateRootRefreshTimer(refresh, init.settings.enabled)
    if (
      !policyChanged &&
      (!init.settings.enabled ||
        (refresh.lastPushedRoots && sameSessionSearchRoots(refresh.lastPushedRoots, init.roots)))
    ) {
      return
    }
    updateSessionSearchInService(init)
    refresh.lastPushedRoots = init.roots
  } catch (error) {
    console.warn('[ai-vault-search] failed to apply session search settings:', error)
  }
}
