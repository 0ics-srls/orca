import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  AiVaultSearchSettingsSchema,
  resolveAiVaultSearchSettings
} from '../../../../shared/ai-vault-search-settings'
import {
  getLocalExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { isWebClientLocation } from '@/lib/web-client-location'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { SettingsRow } from './SettingsFormControls'
import { SessionSearchAdvancedSection } from './SessionSearchAdvancedSection'
import { SessionHistoryComputerRow } from './SessionHistoryComputerRow'
import { SessionHistoryServerRow } from './SessionHistoryServerRow'
import { SessionSearchComputerList } from './SessionSearchComputerList'
import {
  countTurnOnableSessionSearchComputers,
  isTurnOnableSessionSearchState,
  orderSessionSearchServers,
  type SessionSearchComputerEntry,
  type SessionSearchComputerState
} from './session-search-computer-rollup'
import {
  sessionSearchCheckingMessage,
  sessionSearchReadErrorMessage,
  sessionSearchStatusDetails,
  sessionSearchStatusMessage
} from './session-history-status-copy'
import { useSessionSearchAutoEnable } from './use-session-search-auto-enable'
import { useSessionSearchStatus } from './use-session-search-status'
import { useRuntimeEnvironmentCatalog } from './use-runtime-environment-catalog'

export function SessionHistorySettingsPane({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}): React.JSX.Element {
  const policy = resolveAiVaultSearchSettings(settings)
  const autoEnableNewComputers = settings.aiVaultSearchAutoEnableNewComputers === true
  const isWebClient = isWebClientLocation()
  const closeSettingsPage = useAppStore((state) => state.closeSettingsPage)
  const showAiVaultSearch = useAppStore((state) => state.showAiVaultSearch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [serverStates, setServerStates] = useState<Record<string, SessionSearchComputerState>>({})
  const [userToggledServers, setUserToggledServers] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  )
  const { environments, detailsByEnvironmentId } = useRuntimeEnvironmentCatalog()
  const localRead = useSessionSearchStatus({
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    active: policy.enabled && !isWebClient,
    refresh
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const servers = isWebClient ? [] : environments
  const localEntry: SessionSearchComputerEntry = {
    id: LOCAL_EXECUTION_HOST_ID,
    name: getLocalExecutionHostLabel(),
    state: policy.enabled ? 'on' : 'off'
  }
  const serverEntries = servers.map((environment) => ({
    id: environment.id,
    name: environment.name,
    state: serverStates[environment.id] ?? 'checking',
    environment
  }))
  const turnOnableCount = countTurnOnableSessionSearchComputers([localEntry, ...serverEntries])
  const orderedServers = orderSessionSearchServers(serverEntries)
  // Rebuilt each render on purpose: the hook keys off the host ids, not this array.
  const autoEnableTargets = serverEntries
    .filter(
      (entry) => isTurnOnableSessionSearchState(entry.state) && !userToggledServers.has(entry.id)
    )
    .map((entry) => ({
      id: entry.id,
      hostId: toRuntimeExecutionHostId(entry.id),
      name: entry.name
    }))

  const handleServerState = useCallback(
    (environmentId: string, state: SessionSearchComputerState) => {
      setServerStates((current) =>
        current[environmentId] === state ? current : { ...current, [environmentId]: state }
      )
    },
    []
  )

  function writePolicy(updates: Partial<typeof policy>): Promise<void> {
    return updateSettings({
      aiVaultSearch: AiVaultSearchSettingsSchema.parse({ ...policy, ...updates })
    })
  }

  async function save(updates: Partial<typeof policy>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await writePolicy(updates)
    } catch {
      if (mounted.current) {
        setError(saveErrorMessage())
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  function toggleEnabled(): Promise<void> {
    return save({ enabled: !policy.enabled })
  }

  /** A hand-off the user made themselves overrides the standing "turn on new computers" consent. */
  function noteServerToggledByHand(environmentId: string, enabled: boolean): void {
    setUserToggledServers((current) => {
      if (current.has(environmentId)) {
        return current
      }
      const next = new Set(current)
      next.add(environmentId)
      return next
    })
    if (!enabled && autoEnableNewComputers) {
      void updateSettings({ aiVaultSearchAutoEnableNewComputers: false })
    }
  }

  async function turnOnEveryComputer(): Promise<void> {
    setBusy(true)
    setError(null)
    let failed = false
    try {
      if (!policy.enabled) {
        try {
          await writePolicy({ enabled: true })
        } catch {
          failed = true
          setError(saveErrorMessage())
        }
      }
      // One host at a time: a failure is that host's, and it must not stop the rest.
      for (const entry of orderedServers) {
        if (!isTurnOnableSessionSearchState(entry.state)) {
          continue
        }
        try {
          await window.api.aiVault.setSearchEnabled(toRuntimeExecutionHostId(entry.id), true)
        } catch {
          failed = true
          setError(serverToggleErrorMessage(entry.name))
        }
      }
      if (!failed) {
        await updateSettings({ aiVaultSearchAutoEnableNewComputers: true })
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
        setRefresh((value) => value + 1)
      }
    }
  }

  useSessionSearchAutoEnable({
    active: autoEnableNewComputers && !isWebClient,
    targets: autoEnableTargets,
    onError: setError,
    onSettled: () => setRefresh((value) => value + 1)
  })

  /** False when the settings write failed or the pane went away, so the delete is skipped. */
  async function turnSearchOffBeforeDelete(): Promise<boolean> {
    try {
      await writePolicy({ enabled: false })
    } catch {
      if (mounted.current) {
        setError(saveErrorMessage())
      }
      return false
    }
    return mounted.current
  }

  // A stale answer from before the switch went off must not keep reporting progress.
  const localStatus = policy.enabled ? localRead.status : null
  let localStatusText: string | undefined
  if (policy.enabled) {
    localStatusText = localRead.failed
      ? sessionSearchReadErrorMessage()
      : localStatus
        ? sessionSearchStatusMessage(localStatus)
        : sessionSearchCheckingMessage()
  }

  return (
    <div>
      <div className="space-y-1 py-3">
        <Label className="select-text">
          {translate('sessionHistory.settings.indexComputers', 'Search inside sessions')}
        </Label>
        <p className="select-text text-xs text-muted-foreground">
          {isWebClient
            ? translate(
                'sessionHistory.settings.webUnsupported',
                'Turn on session search from the Orca desktop app on that computer.'
              )
            : translate(
                'sessionHistory.settings.computersConsent',
                'Each computer keeps a searchable copy of its own agent conversations and tool output. Nothing leaves that computer.'
              )}
        </p>
      </div>
      {/* With no paired server this row only restates the single switch below it. Each row
          already says whether it is offline or too old, so nothing here counts those again. */}
      {serverEntries.length === 0 ? null : (
        <div className="flex items-center justify-end gap-4 pt-2">
          {turnOnableCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void turnOnEveryComputer()}
            >
              {translate('sessionHistory.settings.turnOnAll', 'Turn on for all {{count}}', {
                count: turnOnableCount
              })}
            </Button>
          ) : autoEnableNewComputers ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'sessionHistory.settings.autoEnableArmed',
                'New computers turn on automatically.'
              )}
            </p>
          ) : null}
        </div>
      )}
      <SessionSearchComputerList
        local={
          <SessionHistoryComputerRow
            kind="local"
            name={localEntry.name}
            checked={policy.enabled}
            disabled={busy || isWebClient}
            onToggle={() => void toggleEnabled()}
            {...(isWebClient || localStatusText === undefined
              ? {}
              : { status: localStatusText, details: sessionSearchStatusDetails(localStatus) })}
          />
        }
        servers={orderedServers.map((entry) => ({
          id: entry.id,
          node: (
            <SessionHistoryServerRow
              environment={entry.environment}
              details={detailsByEnvironmentId[entry.id]}
              refresh={refresh}
              onError={setError}
              onStateChange={handleServerState}
              onUserToggle={noteServerToggledByHand}
            />
          )
        }))}
      />
      {isWebClient ? null : (
        <SettingsRow
          className="border-t border-border"
          label={translate('sessionHistory.settings.openInSidebar', 'Open in the sidebar')}
          description={translate(
            'sessionHistory.settings.openInSidebarCopy',
            'Type what you remember, or ask an agent: “find the session where we fixed the login timeout.”'
          )}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                showAiVaultSearch()
                closeSettingsPage()
              }}
            >
              {translate('sessionHistory.settings.open', 'Open')}
            </Button>
          }
        />
      )}
      <SessionSearchAdvancedSection
        enabled={policy.enabled}
        disabled={isWebClient}
        turnSearchOff={turnSearchOffBeforeDelete}
        onError={setError}
        onCleared={() => setRefresh((value) => value + 1)}
      />
      {error ? (
        <p role="alert" className="pt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function saveErrorMessage(): string {
  return translate('sessionHistory.settings.saveError', 'Could not save. Try again.')
}

function serverToggleErrorMessage(host: string): string {
  return translate(
    'sessionHistory.settings.serverToggleError',
    'Could not change session search on {{host}}. Try again.',
    { host }
  )
}
