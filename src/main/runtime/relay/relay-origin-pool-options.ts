import type WebSocket from 'ws'
import type { E2EEKeypair } from '../e2ee-keypair'
import type { MobileSocketWiring } from '../rpc/mobile-socket-wiring'
import type { RelayIdentity } from './relay-session-broker-contract'
import type { MobileRelayStatus } from '../../../shared/mobile-relay-status'
import type { RelayRegion } from './relay-region-preference'

export type RelayOriginPoolOptions = {
  directorUrl: string
  relayHostId: string
  identity: RelayIdentity
  keypair: E2EEKeypair
  appVersion: string
  mobileSocketWiring: MobileSocketWiring
  isCurrent: () => boolean
  onStatus: (status: MobileRelayStatus) => void
  resolvePreferredRegion?: () => Promise<RelayRegion | undefined>
  fetch?: typeof globalThis.fetch
  createControlSocket?: (url: string, relayJwt: string) => WebSocket
  createDataSocket?: (url: string) => WebSocket
  random?: () => number
  now?: () => number
}
