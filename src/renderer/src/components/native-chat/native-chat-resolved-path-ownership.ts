import { translate } from '@/i18n/i18n'

export type NativeChatResolvedPathOptions = {
  /** Revalidates internal path ownership when an IME-delayed attachment is applied. */
  targetOwnerIsCurrent?: () => boolean
}

export function nativeChatWorkspaceAttachmentMismatchNotice(): string {
  return translate(
    'components.native-chat.composer.workspaceAttachmentMismatch',
    'Files can only be attached to their source workspace.'
  )
}
