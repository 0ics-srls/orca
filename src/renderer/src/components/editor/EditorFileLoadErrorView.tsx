import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { WORKTREE_HOST_UNRESOLVED_CODE } from './editor-panel-content-types'

// Why: `loadError` is stored as English so logs and non-view consumers stay readable; the
// user-facing copy is keyed by the machine sentinel, never by the text, so localization
// cannot break the terminal-state comparison upstream (#21041).
function localizeFileLoadError(message: string, code: string | undefined): string {
  if (code === WORKTREE_HOST_UNRESOLVED_CODE) {
    return translate(
      'editor.fileLoad.hostUnresolved',
      "The host couldn't find this file's workspace. It may have been removed, or the host may still be scanning. Retry, or close the tab."
    )
  }
  return message
}

export function EditorFileLoadErrorView({
  message,
  code,
  onRetry,
  onClose
}: {
  message: string
  code?: string
  onRetry: () => void
  // Why: a tab whose read reached a terminal state must not vanish on its own — the user
  // decides whether to keep retrying or close it (#21041). Callers route the close through
  // the unsaved-changes queue so a dirty draft is still confirmed, never silently dropped.
  onClose?: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-editor-surface p-6 text-sm text-muted-foreground">
      <div className="flex max-w-xl items-start gap-3 rounded-md border border-border bg-background p-4">
        <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {translate('auto.components.editor.EditorContent.39f018b052', 'Unable to load file')}
          </div>
          <div className="mt-1 break-words">{localizeFileLoadError(message, code)}</div>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              {translate('auto.components.editor.EditorContent.2a512bb46a', 'Retry')}
            </Button>
            {onClose ? (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {translate(
                  'auto.components.editor.EditorFileLoadErrorView.296b59cd29',
                  'Close tab'
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
