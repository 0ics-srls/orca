import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordDispatchedAgentNotificationId,
  resetDispatchedAgentNotificationIdsForTests,
  takeDispatchedAgentNotificationIds
} from './dispatched-agent-notification-ids'

describe('dispatched agent notification ids', () => {
  beforeEach(() => resetDispatchedAgentNotificationIdsForTests())

  it('hands back every id sent for a subject once, then forgets them', () => {
    recordDispatchedAgentNotificationId('pane-a', 'id-1')
    recordDispatchedAgentNotificationId('pane-a', 'id-2')
    recordDispatchedAgentNotificationId('pane-a', 'id-1')
    recordDispatchedAgentNotificationId('pane-b', 'id-3')

    expect(takeDispatchedAgentNotificationIds('pane-a')).toEqual(['id-2', 'id-1'])
    expect(takeDispatchedAgentNotificationIds('pane-a')).toEqual([])
    expect(takeDispatchedAgentNotificationIds('pane-b')).toEqual(['id-3'])
  })

  it('stays bounded per subject and across subjects, dropping the least recently notified', () => {
    for (let i = 0; i < 25; i++) {
      recordDispatchedAgentNotificationId('busy', `id-${i}`)
    }
    for (let i = 0; i < 256; i++) {
      recordDispatchedAgentNotificationId(`pane-${i}`, `id-${i}`)
    }
    // `busy` was refreshed last before the flood, so it is the oldest subject and goes first.
    expect(takeDispatchedAgentNotificationIds('busy')).toEqual([])
    recordDispatchedAgentNotificationId('fresh', 'id-fresh')
    expect(takeDispatchedAgentNotificationIds('pane-0')).toEqual([])
    expect(takeDispatchedAgentNotificationIds('pane-255')).toEqual(['id-255'])

    for (let i = 0; i < 25; i++) {
      recordDispatchedAgentNotificationId('capped', `id-${i}`)
    }
    const capped = takeDispatchedAgentNotificationIds('capped')
    expect(capped).toHaveLength(20)
    expect(capped.at(-1)).toBe('id-24')
  })
})
