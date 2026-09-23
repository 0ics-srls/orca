import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { MACHINE_NAME_MAX_LENGTH } from '../../../../shared/machine-name'
import { DebouncedSettingsTextInput } from './DebouncedSettingsTextInput'
import { usePublishedMachineName } from './use-published-machine-name'

/** The name paired devices list this computer under, with the detected name as the blank default. */
export function MobileMachineNameField(): React.JSX.Element {
  const machineName = useAppStore((s) => s.settings?.machineName ?? '')
  const updateSettings = useAppStore((s) => s.updateSettings)
  const publishedMachineName = usePublishedMachineName(machineName)

  return (
    <div className="space-y-2">
      <label htmlFor="mobile-machine-name" className="text-xs font-medium text-foreground">
        {translate('auto.components.settings.MobileMachineNameField.label', 'Machine name')}
      </label>
      <DebouncedSettingsTextInput
        id="mobile-machine-name"
        value={machineName}
        commit={(name) => void updateSettings({ machineName: name })}
        maxLength={MACHINE_NAME_MAX_LENGTH}
        placeholder={
          publishedMachineName ??
          translate(
            'auto.components.settings.MobileMachineNameField.placeholder',
            'Detected automatically'
          )
        }
        aria-describedby="mobile-machine-name-description"
      />
      <p id="mobile-machine-name-description" className="text-xs text-muted-foreground">
        {publishedMachineName
          ? translate(
              'auto.components.settings.MobileMachineNameField.description',
              'Paired devices see “{{name}}”. Leave this blank to use the computer’s own name.',
              { name: publishedMachineName }
            )
          : translate(
              'auto.components.settings.MobileMachineNameField.pending',
              'Paired devices see this name. Leave it blank to use the detected computer name.'
            )}
      </p>
    </div>
  )
}
