import React, { useCallback, useState } from 'react'
import { CircleCheck, CircleDashed, LoaderCircle } from 'lucide-react'
import type { PtyManagementFolderAccessMismatch } from '../../../../preload/api-types'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { track } from '@/lib/telemetry'
import { useMacFolderAccessFixStore } from '@/store/mac-folder-access-fix'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { macFolderAccessFolderName } from './mac-folder-access-folder-name'

const FILES_AND_FOLDERS_PANE = { id: 'files-and-folders' } as const

type RestartState = 'idle' | 'busy' | 'done' | 'failed'

function Step({
  done,
  label,
  helper,
  action
}: {
  done: boolean
  label: string
  helper?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-success" aria-hidden="true" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="text-sm text-foreground">{label}</span>
        {helper ? <span className="text-xs text-muted-foreground">{helper}</span> : null}
        {action}
      </div>
    </li>
  )
}

function FixSteps({
  mismatch,
  restartState,
  onOpenSettings,
  onRestart
}: {
  mismatch: PtyManagementFolderAccessMismatch
  restartState: RestartState
  onOpenSettings: () => void
  onRestart: () => void
}): React.JSX.Element {
  // Why `!== false`: a probe that could not answer must not accuse the user of a missing grant.
  const allowed = mismatch.restartWillHelp !== false
  const busy = restartState === 'busy'
  return (
    <>
      <ol className="flex flex-col gap-3">
        <Step
          done={allowed}
          label={translate(
            'auto.components.shared.MacFolderAccessFixDialog.stepAllow',
            'Allow Orca under Files and Folders'
          )}
          action={
            // Why keep the button on an unanswered probe: opening the pane is the one step the
            // user can always take, and hiding it would strand them.
            mismatch.restartWillHelp === true ? undefined : (
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                {translate(
                  'auto.components.shared.MacFolderAccessFixDialog.openSystemSettings',
                  'Open System Settings'
                )}
              </Button>
            )
          }
        />
        <Step
          done={false}
          label={translate(
            'auto.components.shared.MacFolderAccessFixDialog.stepRestart',
            'Restart Orca’s terminal service'
          )}
          helper={translate(
            'auto.components.shared.MacFolderAccessFixDialog.restartConsequence',
            'Open terminals and agents will restart.'
          )}
          action={
            <Button size="sm" onClick={onRestart} disabled={!allowed || busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {busy
                ? translate(
                    'auto.components.shared.MacFolderAccessFixDialog.restarting',
                    'Restarting…'
                  )
                : translate('auto.components.shared.MacFolderAccessFixDialog.restart', 'Restart')}
            </Button>
          }
        />
      </ol>
      {restartState === 'failed' ? (
        <p className="text-sm text-destructive">
          {translate(
            'auto.components.shared.MacFolderAccessFixDialog.restartFailed',
            'Restart failed. Try again from Settings → Terminal → Manage Sessions.'
          )}
        </p>
      ) : null}
    </>
  )
}

/**
 * The remedy for a daemon macOS refuses a folder to (STA-7948), raised from the folder-access
 * toast. Two steps, because a restart alone only works once Orca itself is allowed again — which
 * step 1 does, and the focus-time poll behind `restartWillHelp` is what notices it landed.
 */
export function MacFolderAccessFixDialog(): React.JSX.Element | null {
  const open = useMacFolderAccessFixStore((s) => s.open)
  const mismatch = useMacFolderAccessFixStore((s) => s.mismatch)
  const close = useMacFolderAccessFixStore((s) => s.close)
  const markRestarted = useMacFolderAccessFixStore((s) => s.markRestarted)
  const [restartState, setRestartState] = useState<RestartState>('idle')
  const mountedRef = useMountedRef()
  const cwdClass = mismatch?.cwdClass ?? null

  const onOpenSettings = useCallback((): void => {
    if (cwdClass) {
      track('daemon_folder_access_notice', { action: 'settings_opened', cwd_class: cwdClass })
    }
    void window.api?.developerPermissions?.openSettings(FILES_AND_FOLDERS_PANE)
  }, [cwdClass])

  const onRestart = useCallback(async (): Promise<void> => {
    if (cwdClass) {
      track('daemon_folder_access_notice', { action: 'restart_clicked', cwd_class: cwdClass })
    }
    setRestartState('busy')
    try {
      const { success } = await window.api.pty.management.restart()
      if (!mountedRef.current) {
        return
      }
      setRestartState(success ? 'done' : 'failed')
      if (success && mismatch) {
        // Why via the store: the replaced daemon's identity is gone, so the poll that raised the
        // toast will never mention it again; the notice hook retires it without logging a dismiss.
        markRestarted(mismatch.daemonScope)
      }
    } catch {
      if (mountedRef.current) {
        setRestartState('failed')
      }
    }
  }, [cwdClass, markRestarted, mismatch, mountedRef])

  if (!mismatch) {
    return null
  }
  const folder = macFolderAccessFolderName(mismatch.cwdClass)
  const busy = restartState === 'busy'
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          close()
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton={!busy}
        onPointerDownOutside={(event) => {
          if (busy) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.shared.MacFolderAccessFixDialog.title',
              'Fix access to your {{folder}}',
              { folder }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.shared.MacFolderAccessFixDialog.lead',
              'macOS is blocking Orca’s terminal service from this folder.'
            )}
          </DialogDescription>
        </DialogHeader>
        {restartState === 'done' ? (
          <p className="text-sm text-foreground">
            {translate(
              'auto.components.shared.MacFolderAccessFixDialog.done',
              'Done. Terminals opened in your {{folder}} can read it now.',
              { folder }
            )}
          </p>
        ) : (
          <FixSteps
            mismatch={mismatch}
            restartState={restartState}
            onOpenSettings={onOpenSettings}
            onRestart={() => void onRestart()}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {translate('auto.components.shared.MacFolderAccessFixDialog.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
