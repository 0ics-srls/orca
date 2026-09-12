import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/lib/ipc-error'
import type { ComposerDropFailure } from './composer-drop-upload-result'

/**
 * Copy for one drop failure. The skip arm has no `default:` on purpose — a new member of the closed
 * enum must fail the build here rather than reach a user as a raw token. An unrecognised reason from
 * a newer host falls off the end and degrades to no detail, which is the right behaviour per
 * `docs/reference/remote-wire-compatibility.md`.
 */
function skipReasonText(failure: ComposerDropFailure): string | undefined {
  if (failure.status === 'failed') {
    // Why route free text through the IPC reader: this reason is minted host-side, can arrive
    // wrapped by `ipcRenderer.invoke`, and can be multi-line — a toast description is one row.
    return failure.reason ? readIpcErrorMessage(new Error(failure.reason)) : undefined
  }
  switch (failure.reason) {
    case undefined:
      return undefined
    case 'missing':
      return translate(
        'auto.hooks.useComposerState.attachSkipMissing',
        'No longer at its original path.'
      )
    case 'symlink':
      return translate(
        'auto.hooks.useComposerState.attachSkipSymlink',
        'Symbolic links cannot be attached.'
      )
    case 'permission-denied':
      return translate(
        'auto.hooks.useComposerState.attachSkipPermissionDenied',
        'Permission denied.'
      )
    case 'unsupported':
      return translate(
        'auto.hooks.useComposerState.attachSkipUnsupported',
        'Unsupported file type.'
      )
  }
}

/** Reports one gesture-neutral summary for a partially applied attachment batch. */
export function showComposerDropFailureToast({
  skippedOrFailed,
  total,
  uniformFailure
}: {
  skippedOrFailed: number
  total: number
  uniformFailure?: ComposerDropFailure
}): void {
  toast.error(
    translate(
      'auto.hooks.useComposerState.dropPartiallyAttached',
      '{{value0}} of {{value1}} item{{value2}} could not be attached.',
      { value0: skippedOrFailed, value1: total, value2: total === 1 ? '' : 's' }
    ),
    { description: uniformFailure ? skipReasonText(uniformFailure) : undefined }
  )
}
