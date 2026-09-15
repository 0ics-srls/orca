import type { UnvalidatedRpcRequestPort } from '../transport/unvalidated-rpc-request-port'
import {
  fetchDictationSetup,
  setDictationConfig,
  downloadDictationModel,
  deleteDictationModel
} from '../dictation/mobile-dictation-setup'
import type { VoiceSettingsOperations } from './voice-settings-operations'

export function nativeVoiceSettingsOperations(
  client: UnvalidatedRpcRequestPort
): VoiceSettingsOperations {
  return {
    load: () => fetchDictationSetup(client),
    configure: (params) => setDictationConfig(client, params),
    download: (modelId) => downloadDictationModel(client, modelId),
    delete: (modelId) => deleteDictationModel(client, modelId)
  }
}
