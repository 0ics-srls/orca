import type { RuntimeSpeechSetupState } from '../../../src/shared/runtime-types'

export interface VoiceSettingsOperations {
  load(): Promise<RuntimeSpeechSetupState>
  configure(params: {
    enabled?: boolean
    modelId?: string
    dictationMode?: 'toggle' | 'hold'
  }): Promise<RuntimeSpeechSetupState>
  download(modelId: string): Promise<void>
  delete(modelId: string): Promise<RuntimeSpeechSetupState>
}
