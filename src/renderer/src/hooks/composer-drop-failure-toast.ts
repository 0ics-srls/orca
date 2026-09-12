import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { compactIpcErrorMessage } from '@/lib/ipc-error'
import type { ComposerDropFailure } from './composer-drop-upload-result'

function skipReasonText(failure: ComposerDropFailure): string | undefined {
  if (failure.status === 'failed') {
    return failure.reason ? compactIpcErrorMessage(failure.reason) : undefined
  }
  switch (failure.reason) {
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
