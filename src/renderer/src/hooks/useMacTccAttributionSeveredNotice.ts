import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type {
  PtyManagementDaemonCwdClass,
  PtyManagementFolderAccessMismatch,
  PtyManagementMacTccAttributionHealth
} from '../../../preload/api-types'
import { isPluginUiLanguage } from '../../../shared/ui-language'
import { useAppStore } from '@/store'
import { usePluginLanguagePackStore } from '@/store/plugin-language-packs'
import { translate } from '@/i18n/i18n'
import { track } from '@/lib/telemetry'
import { resolveUiLocale } from '@/i18n/supported-languages'
import { MANAGE_SESSIONS_SECTION_ID } from '@/components/settings/TerminalTccAttributionNotice'

const SEVERED_TCC_NOTICE_ID = 'mac-tcc-attribution-severed'
const FOLDER_ACCESS_MISMATCH_NOTICE_ID = 'mac-daemon-folder-access-mismatch'

function folderAccessFolderName(cwdClass: PtyManagementDaemonCwdClass): string {
  switch (cwdClass) {
    case 'documents':
      return translate(
        'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessDocuments',
        'Documents folder'
      )
    case 'desktop':
      return translate(
        'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessDesktop',
        'Desktop folder'
      )
    case 'downloads':
      return translate(
        'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessDownloads',
        'Downloads folder'
      )
    case 'other-home':
    case 'outside-home':
      return translate(
        'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessWorkspace',
        'a workspace folder'
      )
  }
}

/** Surface the existing restart remedy when daemon TCC attribution is severed or a folder is denied. */
export function useMacTccAttributionSeveredNotice(): void {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const uiLanguage = useAppStore((s) => s.settings?.uiLanguage ?? null)
  const pluginLanguagePacks = usePluginLanguagePackStore((s) => s.packs)
  const pluginLanguagePacksLoaded = usePluginLanguagePackStore((s) => s.loaded)
  const { i18n } = useTranslation()
  const selectedPluginLanguage = pluginLanguagePacks.find((pack) => pack.id === uiLanguage)
  const targetLocale =
    uiLanguage === null || (isPluginUiLanguage(uiLanguage) && !pluginLanguagePacksLoaded)
      ? null
      : (selectedPluginLanguage?.resourceLanguage ??
        (isPluginUiLanguage(uiLanguage) ? 'en' : resolveUiLocale(uiLanguage)))
  const localeReady =
    targetLocale !== null &&
    i18n.language === targetLocale &&
    i18n.hasResourceBundle(targetLocale, 'translation')
  const toastedThisSession = useRef(false)
  // Why: toast was only marked after await; a focus/effect re-run mid-check could dual-toast.
  const checkInFlight = useRef(false)
  // Scope latches the folder notice to the daemon that earned it: a restart mints a new scope,
  // so the remedy can be offered again, while a dismissed scope stays dismissed this session.
  const folderScopesShown = useRef(new Set<string>())
  const visibleFolderScope = useRef<string | null>(null)

  useEffect(() => {
    if (
      !localeReady ||
      typeof window === 'undefined' ||
      window.api?.platform?.get().platform !== 'darwin'
    ) {
      return
    }
    const macTccAttribution = window.api?.pty?.management?.macTccAttribution
    if (!macTccAttribution) {
      return
    }

    const openManageSessions = (): void => {
      setSettingsSearchQuery('')
      openSettingsTarget({
        pane: 'terminal',
        repoId: null,
        sectionId: MANAGE_SESSIONS_SECTION_ID
      })
      openSettingsPage()
    }

    const applySeveredNotice = (health: PtyManagementMacTccAttributionHealth): void => {
      if (health !== 'severed') {
        if (toastedThisSession.current) {
          toast.dismiss(SEVERED_TCC_NOTICE_ID)
        }
        return
      }
      if (toastedThisSession.current) {
        return
      }
      toastedThisSession.current = true
      toast.warning(
        translate(
          'auto.hooks.useMacTccAttributionSeveredNotice.title',
          'macOS permissions may not reach Orca terminals'
        ),
        {
          id: SEVERED_TCC_NOTICE_ID,
          description: translate(
            'auto.hooks.useMacTccAttributionSeveredNotice.description',
            'Running Orca terminals are hosted by a daemon started by a previous Orca installation. macOS may not apply Orca’s Accessibility, Automation, or protected-file permissions to them. Restart the daemon from Manage Sessions to restore access. This will close all running Orca terminals.'
          ),
          duration: Infinity,
          action: {
            label: translate(
              'auto.hooks.useMacTccAttributionSeveredNotice.openManageSessions',
              'Open Manage Sessions'
            ),
            onClick: openManageSessions
          },
          cancel: {
            label: translate('auto.hooks.useMacTccAttributionSeveredNotice.dismiss', 'Dismiss'),
            onClick: () => {}
          }
        }
      )
    }

    const applyFolderAccessNotice = (mismatch: PtyManagementFolderAccessMismatch | null): void => {
      if (!mismatch) {
        if (visibleFolderScope.current) {
          visibleFolderScope.current = null
          toast.dismiss(FOLDER_ACCESS_MISMATCH_NOTICE_ID)
        }
        return
      }
      if (folderScopesShown.current.has(mismatch.daemonScope)) {
        return
      }
      folderScopesShown.current.add(mismatch.daemonScope)
      visibleFolderScope.current = mismatch.daemonScope
      toast.warning(
        translate(
          'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessTitle',
          'Orca’s terminal service can’t read your {{folder}}.',
          { folder: folderAccessFolderName(mismatch.cwdClass) }
        ),
        {
          id: FOLDER_ACCESS_MISMATCH_NOTICE_ID,
          description: translate(
            'auto.hooks.useMacTccAttributionSeveredNotice.folderAccessDescription',
            'Terminals opened there fail with “Operation not permitted” even though Orca itself can read it. Restart the daemon from Manage Sessions; this closes all running Orca terminals and agents. If it still fails afterwards, re-allow the folder for Orca in System Settings → Privacy & Security → Files and Folders.'
          ),
          duration: Infinity,
          action: {
            label: translate(
              'auto.hooks.useMacTccAttributionSeveredNotice.openManageSessions',
              'Open Manage Sessions'
            ),
            onClick: () => {
              visibleFolderScope.current = null
              track('daemon_folder_access_notice', {
                action: 'open_manage_sessions',
                cwd_class: mismatch.cwdClass
              })
              openManageSessions()
            }
          },
          cancel: {
            label: translate('auto.hooks.useMacTccAttributionSeveredNotice.dismiss', 'Dismiss'),
            onClick: () => {
              visibleFolderScope.current = null
              track('daemon_folder_access_notice', {
                action: 'dismissed',
                cwd_class: mismatch.cwdClass
              })
            }
          }
        }
      )
    }

    const maybeToast = async (): Promise<void> => {
      if (checkInFlight.current) {
        return
      }
      checkInFlight.current = true
      try {
        const { health, folderAccessMismatch } = await macTccAttribution()
        applySeveredNotice(health)
        applyFolderAccessNotice(folderAccessMismatch ?? null)
      } catch {
        // Rejection clears the guard so a later focus can retry.
      } finally {
        checkInFlight.current = false
      }
    }

    void maybeToast()
    const onFocus = (): void => {
      void maybeToast()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [localeReady, openSettingsPage, openSettingsTarget, setSettingsSearchQuery])
}
