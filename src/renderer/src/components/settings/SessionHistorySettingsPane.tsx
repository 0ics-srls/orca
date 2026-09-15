import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  AiVaultSearchSettingsSchema,
  resolveAiVaultSearchSettings
} from '../../../../shared/ai-vault-search-settings'
import {
  getLocalExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { SettingsRow } from './SettingsFormControls'
import { SessionHistoryComputerRow } from './SessionHistoryComputerRow'
import { SessionHistoryServerRow } from './SessionHistoryServerRow'
import {
  sessionSearchCheckingMessage,
  sessionSearchOffMessage,
  sessionSearchReadErrorMessage,
  sessionSearchStatusDetails,
  sessionSearchStatusMessage
} from './session-history-status-copy'
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
  const isWebClient = isWebClientLocation()
  const confirm = useConfirmationDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
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

  async function toggleEnabled(): Promise<void> {
    if (policy.enabled) {
      await save({ enabled: false })
      return
    }
    setBusy(true)
    let accepted = false
    try {
      accepted = await confirm({
        title: translate('sessionHistory.settings.enableTitle', 'Start indexing agent sessions?'),
        description: translate(
          'sessionHistory.settings.enableConsent',
          'Orca will build a local search index on this computer. It copies conversation text and tool output from agent transcripts as written; content is not redacted. Indexing starts now, runs in the background, and the first scan can take several minutes. You can turn it off at any time; progress is kept.'
        ),
        confirmLabel: translate('sessionHistory.settings.enableConfirm', 'Start indexing')
      })
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
    if (!accepted || !mounted.current) {
      return
    }
    await save({ enabled: true })
  }

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

  async function deleteIndex(): Promise<void> {
    const wasEnabled = policy.enabled
    setBusy(true)
    setError(null)
    try {
      const accepted = await confirm({
        title: translate(
          'sessionHistory.settings.deleteTitle',
          'Delete this computer’s search index?'
        ),
        description: deleteDescription(wasEnabled),
        confirmLabel: translate('sessionHistory.settings.delete', 'Delete index'),
        confirmVariant: 'destructive'
      })
      if (!accepted || !mounted.current) {
        return
      }
      // Clearing while search is on makes the host rebuild the index immediately; turn it off first.
      if (wasEnabled && !(await turnSearchOffBeforeDelete())) {
        return
      }
      await window.api.aiVault.clearSearchIndex()
      if (mounted.current) {
        setRefresh((value) => value + 1)
        toast.success(
          wasEnabled
            ? translate(
                'sessionHistory.settings.clearedAndTurnedOff',
                'Search is off and the index was deleted. Original transcripts were kept.'
              )
            : translate(
                'sessionHistory.settings.cleared',
                'Search index cleared. Original transcripts were kept.'
              )
        )
      }
    } catch {
      if (mounted.current) {
        setError(
          translate('sessionHistory.settings.clearError', 'Could not clear the index. Try again.')
        )
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  // A stale answer from before the switch went off must not keep reporting progress.
  const localStatus = policy.enabled ? localRead.status : null
  let localStatusText = sessionSearchOffMessage()
  if (policy.enabled) {
    localStatusText = localRead.failed
      ? sessionSearchReadErrorMessage()
      : localStatus
        ? sessionSearchStatusMessage(localStatus)
        : sessionSearchCheckingMessage()
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border">
        <div className="space-y-1 py-3">
          <Label className="select-text">
            {translate('sessionHistory.settings.indexComputers', 'Index agent sessions')}
          </Label>
          <p className="select-text text-xs text-muted-foreground">
            {isWebClient
              ? translate(
                  'sessionHistory.settings.webUnsupported',
                  'Manage indexing in the Orca desktop app on the computer that owns the transcripts. These controls are unavailable from a paired client.'
                )
              : translate(
                  'sessionHistory.settings.computersConsent',
                  'Each computer keeps a local index of its own transcripts, including conversation text and tool output as written. Content is not redacted. Turning a computer off stops indexing and keeps its index.'
                )}
          </p>
        </div>
        <SessionHistoryComputerRow
          kind="local"
          name={getLocalExecutionHostLabel()}
          checked={policy.enabled}
          disabled={busy || isWebClient}
          onToggle={() => void toggleEnabled()}
          {...(isWebClient
            ? {}
            : { status: localStatusText, details: sessionSearchStatusDetails(localStatus) })}
        />
        {isWebClient
          ? null
          : environments.map((environment) => (
              <SessionHistoryServerRow
                key={environment.id}
                environment={environment}
                details={detailsByEnvironmentId[environment.id]}
                onError={setError}
              />
            ))}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="pt-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 text-xs">
              {translate('sessionHistory.settings.advanced', 'Advanced')}
              <ChevronDown
                className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="collapsible-height-content">
            <SettingsRow
              label={translate('sessionHistory.settings.deleteIndexCopy', 'Delete index copy')}
              description={deleteDescription(policy.enabled)}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || isWebClient}
                  onClick={() => void deleteIndex()}
                >
                  {translate('sessionHistory.settings.delete', 'Delete index')}
                </Button>
              }
            />
          </CollapsibleContent>
        </Collapsible>
        {error ? (
          <p role="alert" className="pt-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'sessionHistory.settings.sshNote',
          'SSH hosts appear here once indexing is available on SSH.'
        )}
      </p>
    </div>
  )
}

function saveErrorMessage(): string {
  return translate(
    'sessionHistory.settings.saveError',
    'Could not save session search settings. Try again.'
  )
}

/** Shared by the Advanced row and its confirm dialog so both promise the same thing. */
function deleteDescription(enabled: boolean): string {
  return enabled
    ? translate(
        'sessionHistory.settings.deleteEnabled',
        'Turn off search on this computer and remove its index. Original transcripts are not touched. Switch search back on to rebuild.'
      )
    : translate(
        'sessionHistory.settings.deleteDisabled',
        'Remove the search index from this computer. Original transcripts are not touched. Search stays off.'
      )
}
