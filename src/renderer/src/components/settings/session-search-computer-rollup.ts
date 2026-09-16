import { translate } from '@/i18n/i18n'

/**
 * What one computer in the pane is doing, as far as this client can tell.
 *
 * `checking` is not `offline`: a probe still in flight is no evidence the host
 * is unreachable, so it is neither counted as offline nor skipped as one.
 */
export type SessionSearchComputerState = 'on' | 'off' | 'checking' | 'needs-update' | 'offline'

export type SessionSearchComputerEntry = {
  id: string
  name: string
  state: SessionSearchComputerState
}

export type SessionSearchFleetSummary = {
  on: number
  total: number
  offline: number
  needUpdate: number
  /** Reachable, new enough, and still off: exactly what Turn on all would act on. */
  turnOnable: number
}

export function isTurnOnableSessionSearchState(state: SessionSearchComputerState): boolean {
  return state === 'off'
}

export function summarizeSessionSearchComputers(
  entries: readonly SessionSearchComputerEntry[]
): SessionSearchFleetSummary {
  const count = (state: SessionSearchComputerState): number =>
    entries.filter((entry) => entry.state === state).length
  return {
    on: count('on'),
    total: entries.length,
    offline: count('offline'),
    needUpdate: count('needs-update'),
    turnOnable: entries.filter((entry) => isTurnOnableSessionSearchState(entry.state)).length
  }
}

/** Sentence above the list. A segment worth zero is left out rather than printed as "0". */
export function sessionSearchSummarySentence(
  summary: SessionSearchFleetSummary,
  autoEnableNewComputers: boolean
): string {
  const segments = [
    translate('sessionHistory.settings.summaryOn', 'On {{on}} of {{total}} computers', {
      on: summary.on,
      total: summary.total
    })
  ]
  if (summary.offline > 0) {
    segments.push(
      translate('sessionHistory.settings.summaryOffline', '{{offline}} offline', {
        offline: summary.offline
      })
    )
  }
  if (summary.needUpdate > 0) {
    segments.push(
      translate('sessionHistory.settings.summaryNeedUpdate', '{{needUpdate}} need an update', {
        needUpdate: summary.needUpdate
      })
    )
  }
  const sentence = segments.join(' · ')
  return autoEnableNewComputers
    ? `${sentence} ${translate('sessionHistory.settings.summaryAutoEnable', 'New computers turn on when they can.')}`
    : sentence
}

// Reachable and working first, then what the user could act on, then what they cannot.
const STATE_RANK: Record<SessionSearchComputerState, number> = {
  on: 0,
  off: 1,
  checking: 1,
  'needs-update': 2,
  offline: 3
}

/** Stable order for the server list: by state group, then by name within a group. */
export function orderSessionSearchServers<T extends SessionSearchComputerEntry>(
  entries: readonly T[]
): T[] {
  return [...entries].sort((left, right) => {
    const byState = STATE_RANK[left.state] - STATE_RANK[right.state]
    return byState === 0 ? left.name.localeCompare(right.name) : byState
  })
}
