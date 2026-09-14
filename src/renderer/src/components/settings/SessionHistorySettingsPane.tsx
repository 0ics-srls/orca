import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  AiVaultSearchSettingsSchema,
  resolveAiVaultSearchSettings
} from '../../../../shared/ai-vault-search-settings'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { translate } from '@/i18n/i18n'
import { SettingsRow, SettingsSwitchRow } from './SettingsFormControls'
import { SessionHistoryIndexStatus } from './SessionHistoryIndexStatus'

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
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function save(updates: Partial<typeof policy>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await updateSettings({
        aiVaultSearch: AiVaultSearchSettingsSchema.parse({ ...policy, ...updates })
      })
    } catch {
      if (mounted.current) {
        setError(
          translate(
            'sessionHistory.settings.saveError',
            'Could not save session search settings. Try again.'
          )
        )
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  async function clearIndex(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const accepted = await confirm({
        title: translate(
          'sessionHistory.settings.clearTitle',
          'Clear this computer’s search index?'
        ),
        description: policy.enabled
          ? translate(
              'sessionHistory.settings.clearEnabled',
              'The index copy will be deleted and rebuilt because search is enabled. Original transcripts will not be deleted.'
            )
          : translate(
              'sessionHistory.settings.clearDisabled',
              'The index copy will be deleted. Original transcripts will not be deleted. Search will stay off.'
            ),
        confirmLabel: translate('sessionHistory.settings.clear', 'Clear index'),
        confirmVariant: 'destructive'
      })
      if (!accepted || !mounted.current) {
        return
      }
      await window.api.aiVault.clearSearchIndex()
      if (mounted.current) {
        setRefresh((value) => value + 1)
        toast.success(
          translate(
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

  const retentionLabel = translate('sessionHistory.settings.retention', 'Searchable history')
  return (
    <div className="divide-y divide-border">
      <SettingsSwitchRow
        label={translate('sessionHistory.settings.enable', 'Enable session history search')}
        description={
          isWebClient
            ? translate(
                'sessionHistory.settings.webUnsupported',
                'Manage indexing in the Orca desktop app on the computer that owns the transcripts. These controls are unavailable from a paired client.'
              )
            : translate(
                'sessionHistory.settings.consent',
                'Create a local index copy of agent transcripts on this computer, including conversation text and tool output as written. Content is not redacted. Turning search off stops indexing and keeps the index copy.'
              )
        }
        checked={policy.enabled}
        disabled={busy || isWebClient}
        onChange={() => void save({ enabled: !policy.enabled })}
      />
      <SettingsRow
        label={retentionLabel}
        description={translate(
          'sessionHistory.settings.retentionDescription',
          'Include transcripts modified within this period. Older content is removed from the index on the next sweep; original transcripts are never deleted.'
        )}
        control={
          <Select
            value={String(policy.historyDays ?? 'all')}
            disabled={busy || isWebClient}
            onValueChange={(value) =>
              void save({ historyDays: value === 'all' ? null : Number(value) })
            }
          >
            <SelectTrigger aria-label={retentionLabel} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {translate('sessionHistory.settings.all', 'All history')}
              </SelectItem>
              <SelectItem value="90">
                {translate('sessionHistory.settings.days90', '90 days')}
              </SelectItem>
              <SelectItem value="30">
                {translate('sessionHistory.settings.days30', '30 days')}
              </SelectItem>
              {policy.historyDays !== null &&
              policy.historyDays !== 90 &&
              policy.historyDays !== 30 ? (
                <SelectItem value={String(policy.historyDays)}>
                  {translate('sessionHistory.settings.customDays', '{{days}} days', {
                    days: policy.historyDays
                  })}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        }
      />
      {!isWebClient ? (
        <SessionHistoryIndexStatus enabled={policy.enabled} refresh={refresh} busy={busy} />
      ) : null}
      <SettingsRow
        label={translate('sessionHistory.settings.indexCopy', 'Index copy')}
        description={translate(
          'sessionHistory.settings.clearDescription',
          'Clear only the search index on this computer. If search is enabled, Orca builds it again.'
        )}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={busy || isWebClient}
            onClick={() => void clearIndex()}
          >
            {translate('sessionHistory.settings.clear', 'Clear index')}
          </Button>
        }
      />
      {error ? (
        <p role="alert" className="pt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
