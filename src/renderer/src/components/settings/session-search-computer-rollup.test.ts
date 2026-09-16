import { expect, it, vi } from 'vitest'
import {
  isTurnOnableSessionSearchState,
  orderSessionSearchServers,
  sessionSearchSummarySentence,
  summarizeSessionSearchComputers,
  type SessionSearchComputerEntry
} from './session-search-computer-rollup'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, args?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(args?.[key]))
}))

const fleet: SessionSearchComputerEntry[] = [
  { id: 'local', name: 'Local Mac', state: 'on' },
  { id: 'a', name: 'build-01', state: 'on' },
  { id: 'b', name: 'gpu-a', state: 'off' },
  { id: 'c', name: 'linux 1', state: 'offline' },
  { id: 'd', name: 'nas', state: 'offline' },
  { id: 'e', name: 'm4 air', state: 'needs-update' },
  { id: 'f', name: 'probing', state: 'checking' }
]

it('counts what the user can see and what they could act on', () => {
  expect(summarizeSessionSearchComputers(fleet)).toEqual({
    on: 2,
    total: 7,
    offline: 2,
    needUpdate: 1,
    turnOnable: 1
  })
})

it('will not offer to turn on a computer it cannot reach or that is too old', () => {
  expect(isTurnOnableSessionSearchState('off')).toBe(true)
  for (const state of ['on', 'offline', 'needs-update', 'checking'] as const) {
    expect(isTurnOnableSessionSearchState(state)).toBe(false)
  }
})

it('leaves a zero segment out of the sentence rather than printing it', () => {
  expect(sessionSearchSummarySentence(summarizeSessionSearchComputers(fleet), false)).toBe(
    'On 2 of 7 computers · 2 offline · 1 need an update'
  )
  const onlyLocal = summarizeSessionSearchComputers([fleet[0]])
  expect(sessionSearchSummarySentence(onlyLocal, false)).toBe('On 1 of 1 computers')
})

it('promises to keep new computers turned on only when that is the standing consent', () => {
  const summary = summarizeSessionSearchComputers([fleet[0]])
  expect(sessionSearchSummarySentence(summary, true)).toBe(
    'On 1 of 1 computers New computers turn on when they can.'
  )
  expect(sessionSearchSummarySentence(summary, false)).not.toContain('New computers')
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
