import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { parseNativeChatShellEnvironmentNames } from '../../../../shared/native-chat-shell-environment'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { SettingsSwitch } from './SettingsFormControls'

type NativeChatShellEnvironmentSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const NAMES_INPUT_ID = 'settings-native-chat-shell-environment-names'

function ShellEnvironmentNamesField({
  savedNames,
  onCommit
}: {
  savedNames: readonly string[]
  onCommit: (names: string[]) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(savedNames.join(', '))
  const commit = (): void => {
    const names = parseNativeChatShellEnvironmentNames(draft)
    setDraft(names.join(', '))
    if (names.join('\n') !== savedNames.join('\n')) {
      onCommit(names)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={NAMES_INPUT_ID}>
        {translate(
          'auto.components.settings.ExperimentalPane.nativeChat.shellEnvNamesLabel',
          'Variables to pass from your shell'
        )}
      </Label>
      <Textarea
        id={NAMES_INPUT_ID}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        placeholder={translate(
          'auto.components.settings.ExperimentalPane.nativeChat.shellEnvNamesPlaceholder',
          'HTTPS_PROXY, OPENAI_BASE_URL'
        )}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        rows={3}
      />
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.ExperimentalPane.nativeChat.shellEnvNamesHelp',
          'Separate names with commas, spaces, or new lines. PATH, locale, and SSH_AUTH_SOCK are always passed. Applies the next time a chat starts or resumes.'
        )}
      </p>
    </div>
  )
}

export function NativeChatShellEnvironmentSetting({
  settings,
  updateSettings
}: NativeChatShellEnvironmentSettingProps): React.JSX.Element {
  const inheritAll = settings.nativeChatInheritShellEnvironment !== false
  const savedNames = settings.nativeChatShellEnvironmentVariables ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.ExperimentalPane.nativeChat.shellEnvTitle',
              'Use your shell environment'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.ExperimentalPane.nativeChat.shellEnvCopy',
              'Codex and Claude chats start with every variable your login shell exports, the same as a terminal. Turn off to choose which ones they get.'
            )}
          </p>
        </div>
        <SettingsSwitch
          checked={inheritAll}
          ariaLabel={translate(
            'auto.components.settings.ExperimentalPane.nativeChat.shellEnvToggleLabel',
            'Toggle using your shell environment'
          )}
          onChange={() => updateSettings({ nativeChatInheritShellEnvironment: !inheritAll })}
        />
      </div>
      {inheritAll ? null : (
        // Keyed on the saved list so an outside change replaces a stale draft.
        <ShellEnvironmentNamesField
          key={savedNames.join('\n')}
          savedNames={savedNames}
          onCommit={(names) => updateSettings({ nativeChatShellEnvironmentVariables: names })}
        />
      )}
    </div>
  )
}
