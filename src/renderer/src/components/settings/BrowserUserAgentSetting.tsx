import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { BrowserUserAgentMode } from '../../../../shared/browser-user-agent-mode'
import { BROWSER_USER_AGENT_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'

type BrowserUserAgentSettingProps = {
  settings: Pick<GlobalSettings, 'browserUserAgentMode'>
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function BrowserUserAgentSetting({
  settings,
  updateSettings
}: BrowserUserAgentSettingProps): React.JSX.Element {
  const title = translate('settings.browser.userAgent.title', 'Browser identity')
  const description = translate(
    'settings.browser.userAgent.description',
    'Choose the user agent for every browser profile and page. Changes take effect after a restart.'
  )

  return (
    <SearchableSetting
      id={BROWSER_USER_AGENT_SETTINGS_TARGET_ID}
      title={title}
      description={description}
      keywords={['browser', 'identity', 'user agent', 'native', 'cleaned', 'restart']}
    >
      <SettingsRow
        label={title}
        description={description}
        control={
          <SettingsSegmentedControl<BrowserUserAgentMode>
            size="sm"
            ariaLabel={title}
            value={settings.browserUserAgentMode}
            onChange={(browserUserAgentMode) => updateSettings({ browserUserAgentMode })}
            options={[
              {
                value: 'clean',
                label: translate('settings.browser.userAgent.optionClean', 'Cleaned'),
                tooltip: translate(
                  'settings.browser.userAgent.optionCleanTooltip',
                  'Removes Orca and Electron tokens to match imported Chrome sessions.'
                )
              },
              {
                value: 'native',
                label: translate('settings.browser.userAgent.optionNative', 'Native'),
                tooltip: translate(
                  'settings.browser.userAgent.optionNativeTooltip',
                  "Keeps Electron's built-in identity for sites that reject the cleaned identity."
                )
              }
            ]}
          />
        }
      />
    </SearchableSetting>
  )
}
