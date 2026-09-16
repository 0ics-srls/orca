import { expect, it } from 'vitest'
import {
  countTurnOnableSessionSearchComputers,
  isTurnOnableSessionSearchState,
  orderSessionSearchServers,
  type SessionSearchComputerEntry
} from './session-search-computer-rollup'

const fleet: SessionSearchComputerEntry[] = [
  { id: 'local', name: 'Local Mac', state: 'on' },
  { id: 'a', name: 'build-01', state: 'on' },
  { id: 'b', name: 'gpu-a', state: 'off' },
  { id: 'c', name: 'linux 1', state: 'offline' },
  { id: 'd', name: 'nas', state: 'offline' },
  { id: 'e', name: 'm4 air', state: 'needs-update' },
  { id: 'f', name: 'probing', state: 'checking' }
]

it('counts only the computers a turn-on would actually reach', () => {
  expect(countTurnOnableSessionSearchComputers(fleet)).toBe(1)
  expect(countTurnOnableSessionSearchComputers([])).toBe(0)
  expect(
    countTurnOnableSessionSearchComputers([
      { id: 'a', name: 'a', state: 'off' },
      { id: 'b', name: 'b', state: 'off' }
    ])
  ).toBe(2)
})

it('will not offer to turn on a computer it cannot reach or that is too old', () => {
  expect(isTurnOnableSessionSearchState('off')).toBe(true)
  for (const state of ['on', 'offline', 'needs-update', 'checking'] as const) {
    expect(isTurnOnableSessionSearchState(state)).toBe(false)
  }
})

it('orders reachable and working first, then by name inside each group', () => {
  const ordered = orderSessionSearchServers([
    { id: 'f', name: 'probing', state: 'checking' },
    { id: 'c', name: 'linux 1', state: 'offline' },
    { id: 'e', name: 'm4 air', state: 'needs-update' },
    { id: 'b', name: 'gpu-a', state: 'off' },
    { id: 'a', name: 'build-01', state: 'on' },
    { id: 'z', name: 'aa-on', state: 'on' }
  ])
  expect(ordered.map((entry) => entry.name)).toEqual([
    'aa-on',
    'build-01',
    'gpu-a',
    'probing',
    'm4 air',
    'linux 1'
  ])
})
