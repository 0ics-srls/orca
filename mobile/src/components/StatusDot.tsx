import { View, StyleSheet } from 'react-native'
import { colors } from '../theme/mobile-theme'
import type { ConnectionState } from '../transport/types'
import type { ConnectionVerdict } from '../transport/connection-health'

const DOT_SIZE = 8
const DOT_LABEL_GAP = 8
/** Where the dot's label starts, for a second line that aligns under that label. */
export const STATUS_DOT_LABEL_INSET = DOT_SIZE + DOT_LABEL_GAP

const stateColors: Record<ConnectionState, string> = {
  connected: colors.statusGreen,
  connecting: colors.statusAmber,
  handshaking: colors.statusAmber,
  reconnecting: colors.statusAmber,
  disconnected: colors.textMuted,
  'auth-failed': colors.statusRed
}

export function statusDotColor(state: ConnectionState, verdict?: ConnectionVerdict): string {
  if (verdict?.kind === 'unreachable' || verdict?.kind === 'auth-failed') {
    return colors.statusRed
  }
  if (verdict?.kind === 'warning' || (verdict?.kind === 'normal' && verdict.label.endsWith('…'))) {
    return colors.statusAmber
  }
  return stateColors[state] ?? colors.textMuted
}

// Why: when caller passes a verdict, the dot color reflects the verdict's
// severity instead of the raw transport state. This avoids the "amber dot
// next to red 'Can't reach desktop' label" mismatch — the underlying
// transport is still 'reconnecting' (amber) but the user-visible meaning
// has escalated to error (red).
export function StatusDot({
  state,
  verdict
}: {
  state: ConnectionState
  verdict?: ConnectionVerdict
}) {
  const color = statusDotColor(state, verdict)
  return <View style={[styles.dot, { backgroundColor: color }]} />
}

const styles = StyleSheet.create({
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginRight: DOT_LABEL_GAP
  }
})
