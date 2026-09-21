import type React from 'react'
import { MobilePairingQrSection } from './MobilePairingQrSection'
import { WindowsFirewallNotice } from '../mobile/WindowsFirewallNotice'
import { MobilePairedDevicesSection } from './MobilePairedDevicesSection'
import { MobileAutoRestoreFitSection } from './MobileAutoRestoreFitSection'
import type { PairedMobileDevice } from '../mobile/paired-mobile-devices'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

type MobilePanePairingOutputProps = {
  qrDataUrl: string | null
  qrSize: number | null
  qrError: boolean
  pairingUrl: string | null
  endpoint: string | null
  qrEnlarged: boolean
  codeCopied: boolean
  onQrEnlargedChange: (value: boolean) => void
  onCodeCopiedChange: (value: boolean) => void
  onClearCodeCopiedTimer: () => void
  connectionMode: MobilePairingConnectionMode
  selectedAddress: string | null
  devices: readonly PairedMobileDevice[]
  onRevokeDevice: (deviceId: string) => void
  autoRestoreFitMs: number | null
  onAutoRestoreFitChange: (milliseconds: number | null) => void
}

export function MobilePanePairingOutput(props: MobilePanePairingOutputProps): React.JSX.Element {
  return (
    <>
      <MobilePairingQrSection
        qrDataUrl={props.qrDataUrl}
        qrSize={props.qrSize}
        qrError={props.qrError}
        pairingUrl={props.pairingUrl}
        endpoint={props.endpoint}
        qrEnlarged={props.qrEnlarged}
        codeCopied={props.codeCopied}
        onQrEnlargedChange={props.onQrEnlargedChange}
        onCodeCopiedChange={props.onCodeCopiedChange}
        onClearCodeCopiedTimer={props.onClearCodeCopiedTimer}
      />
      <WindowsFirewallNotice
        pairingReady={props.pairingUrl != null}
        address={props.selectedAddress}
        usingRelay={props.connectionMode === 'automatic'}
      />
      <MobilePairedDevicesSection
        devices={props.devices}
        hasQrCode={props.qrDataUrl != null}
        onRevokeDevice={props.onRevokeDevice}
      />
      <MobileAutoRestoreFitSection
        autoRestoreFitMs={props.autoRestoreFitMs}
        onAutoRestoreFitChange={props.onAutoRestoreFitChange}
      />
    </>
  )
}
