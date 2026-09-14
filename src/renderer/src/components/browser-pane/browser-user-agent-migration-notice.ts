import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { BROWSER_USER_AGENT_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'

let pendingNotice: Promise<void> | null = null

async function showPendingBrowserUserAgentMigrationNoticeImpl(): Promise<void> {
  const migratedProfileIds = await window.api.browser.sessionReadUserAgentMigrationNotice()
  if (migratedProfileIds === null) {
    return
  }
  toast.warning(translate('browser.userAgentMigration.title', 'Browser identity is now app-wide'), {
    description: translate(
      'browser.userAgentMigration.description',
      'Per-profile user-agent settings were removed. Choose Cleaned or Native in Browser settings; changes take effect after a restart.'
    ),
    duration: Infinity,
    action: {
      label: translate('browser.userAgentMigration.openSettings', 'Open Settings'),
      onClick: () => {
        const store = useAppStore.getState()
        store.openSettingsPage()
        store.openSettingsTarget({
          pane: 'browser',
          repoId: null,
          sectionId: BROWSER_USER_AGENT_SETTINGS_TARGET_ID
        })
      }
    }
  })
  await window.api.browser.sessionClearUserAgentMigrationNotice()
}

export function showPendingBrowserUserAgentMigrationNotice(): Promise<void> {
  pendingNotice ??= showPendingBrowserUserAgentMigrationNoticeImpl()
  return pendingNotice
}
