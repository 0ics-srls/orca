import { useEffect, useState } from 'react'
import type { AiVaultSearchStatus } from '../../../../shared/ai-vault-search-types'
import { useWindowStreamVisible } from '@/hooks/use-window-stream-visibility'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { SettingsRow } from './SettingsFormControls'

export function SessionHistoryIndexStatus({
  enabled,
  refresh,
  busy
}: {
  enabled: boolean
  refresh: number
  busy: boolean
}): React.JSX.Element {
  const visible = useWindowStreamVisible(0)
  const [status, setStatus] = useState<AiVaultSearchStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [requested, setRequested] = useState(0)
  useEffect(() => {
    setStatus(null)
    setFailed(false)
    if (!enabled || !visible || busy) {
      return
    }
    let disposed = false
    let inFlight = false
    async function read(): Promise<void> {
      if (inFlight || disposed) {
        return
      }
      inFlight = true
      setLoading(true)
      try {
        const next = await Promise.resolve().then(() => window.api.aiVault.searchStatus('local'))
        if (disposed) {
          return
        }
        setStatus(next)
        // Only an observed indexing pass needs live progress; idle state has no timer.
        if (!next.enabled || next.phase !== 'indexing') {
          stopPolling()
        }
      } catch {
        if (!disposed) {
          setStatus(null)
          setFailed(true)
          stopPolling()
        }
      } finally {
        inFlight = false
        if (!disposed) {
          setLoading(false)
        }
      }
    }
    const stopPolling = installWindowVisibilityInterval({
      run: () => void read(),
      intervalMs: 5_000
    })
    return () => {
      disposed = true
      stopPolling()
    }
  }, [enabled, visible, busy, refresh, requested])

  let message = translate('sessionHistory.status.checking', 'Checking index…')
  if (!enabled) {
    message = translate(
      'sessionHistory.status.off',
      'Search is off. Any existing index copy is kept.'
    )
  } else if (failed) {
    message = translate(
      'sessionHistory.status.error',
      'Could not read index status. Try refreshing.'
    )
  } else if (status) {
    switch (status.phase) {
      case 'indexing':
        message = translate('sessionHistory.status.indexing', 'Indexing transcripts…')
        break
      case 'current':
        message = translate(
          'sessionHistory.status.current',
          'Index is up to date with the last scan.'
        )
        break
      case 'degraded':
        message = translate(
          'sessionHistory.status.degraded',
          'Some transcript sources could not be indexed.'
        )
        break
      case 'idle':
      case 'closed':
        message = translate(
          'sessionHistory.status.unavailable',
          'Index is not ready or the search service is unavailable.'
        )
        break
    }
    if (!status.enabled) {
      message = translate(
        'sessionHistory.status.unavailable',
        'Index is not ready or the search service is unavailable.'
      )
    }
  }
  return (
    <SettingsRow
      label={translate('sessionHistory.status.title', 'Index status')}
      description={
        <span role="status" className="space-y-1 block">
          <span className="block">{message}</span>
          {enabled && status?.enabled && status.phase !== 'idle' && status.phase !== 'closed' ? (
            <span className="block">
              {translate(
                'sessionHistory.status.counts',
                'Indexed files: {{indexed}} · Due: {{due}} · Failed: {{failed}}',
                { indexed: status.filesIndexed, due: status.filesDue, failed: status.filesFailed }
              )}
            </span>
          ) : null}
          {enabled && status?.enabled && status.degradedRoots.length > 0 ? (
            <span className="block">
              {translate('sessionHistory.status.roots', 'Unverified source roots: {{roots}}', {
                roots: status.degradedRoots.length
              })}
            </span>
          ) : null}
        </span>
      }
      control={
        <Button
          variant="outline"
          size="sm"
          disabled={!enabled || busy || loading || !visible}
          onClick={() => setRequested((value) => value + 1)}
        >
          {translate('sessionHistory.status.refresh', 'Refresh')}
        </Button>
      }
    />
  )
}
