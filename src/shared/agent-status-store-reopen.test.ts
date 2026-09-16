import { describe, expect, it } from 'vitest'
import { createAgentStatusStore } from './agent-status-store'
import { AGENT_STATUS_STORE_LIMITS } from './agent-status-store-contract'
import {
  makePtyRunAgentStatusSubject,
  makeStructuredAgentStatusSubject
} from './agent-status-subject'

const scope = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'folder-one',
  workspaceKind: 'folder'
} as const
const subject = makeStructuredAgentStatusSubject(scope, 'durable-session')

describe('structured parent reopening', () => {
  it('reopens a removed structured parent and fences replay from before the reopen', () => {
    const owner = createAgentStatusStore({ epoch: 'host', mode: 'authority' })
    const replica = createAgentStatusStore({ epoch: 'reader', mode: 'replica' })
    const oldPublication = owner.applyMutation({ parent: { subject, firstObservedAt: 10 } })
    expect(oldPublication).not.toBeNull()
    expect(replica.applySnapshot(owner.getSnapshot())).toBe(true)
    const removal = owner.applyMutation({ removeParent: subject })
    expect(removal).not.toBeNull()
    expect(replica.applyTransportEnvelope(removal)).toBe(true)

    const reopened = owner.applyMutation({ parent: { subject, firstObservedAt: 30 } })
    expect(reopened).not.toBeNull()
    expect(replica.applyTransportEnvelope(reopened)).toBe(true)
    expect(replica.getParent(subject)).toEqual(owner.getParent(subject))
    expect(replica.applyTransportEnvelope(oldPublication)).toBe(false)
    expect(replica.getSnapshot()).toEqual(owner.getSnapshot())

    // The revision envelope, not the tombstone's presence, is what fences the stale replay.
    expect(
      owner.applyMutation({
        removeChildren: Array.from(
          { length: AGENT_STATUS_STORE_LIMITS.tombstones + 1 },
          (_, index) => `unused-child-${index}`
        )
      })
    ).not.toBeNull()
    expect(owner.getSnapshot().tombstones.some((item) => item.entity === 'parent')).toBe(false)
    expect(replica.applySnapshot(owner.getSnapshot())).toBe(true)
    expect(replica.applyTransportEnvelope(oldPublication)).toBe(false)
    expect(replica.getParent(subject)?.firstObservedAt).toBe(30)
  })

  it('fences a republication only inside the removing mutation, for every subject kind', () => {
    const owner = createAgentStatusStore({ epoch: 'host', mode: 'authority' })
    const pty = makePtyRunAgentStatusSubject(scope, 'retired-run')
    expect(owner.applyMutation({ parent: { subject: pty } })).not.toBeNull()
    expect(owner.applyMutation({ removeParent: pty })).not.toBeNull()

    // Same mutation: the tombstone shares this revision, so it outranks the republication.
    const contradiction = owner.getSnapshot()
    expect(owner.applyMutation({ removeParent: subject, parent: { subject } })).toBeNull()
    expect(owner.getSnapshot()).toEqual(contradiction)

    // A later mutation outranks the tombstone regardless of kind — PTY runs included.
    expect(owner.applyMutation({ parent: { subject: pty } })).not.toBeNull()
    expect(owner.getParent(pty)).not.toBeNull()

    expect(owner.applyMutation({})).toBeNull()
  })
})
