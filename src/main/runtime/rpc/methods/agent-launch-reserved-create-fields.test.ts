/**
 * `AGENT_LAUNCH_RESERVED_CREATE_FIELDS` is a hand-written list of keys in a schema that is edited
 * somewhere else entirely. Nothing makes the two move together, so the failure mode is silent in
 * both directions: a new `startup*` field on `worktree.create` reaches `createManagedWorktree`
 * unstripped and re-opens the agent-first path the router exists to replace, and a renamed field
 * leaves a stale entry that strips nothing while still reading as coverage.
 *
 * This asserts the correspondence rather than the list.
 */

import { describe, expect, it } from 'vitest'
import { AGENT_LAUNCH_RESERVED_CREATE_FIELDS } from '../../../../shared/agent-launch-intent'
import { WorktreeCreate } from './worktree-create-schemas'

const CREATE_KEYS = Object.keys(WorktreeCreate.shape)
const RESERVED = new Set<string>(AGENT_LAUNCH_RESERVED_CREATE_FIELDS)

describe('the create fields agent.launch reserves', () => {
  it('covers every startup field the create schema has', () => {
    const startupKeys = CREATE_KEYS.filter((key) => key.startsWith('startup'))
    // Positive control: an empty list here would make the assertion below vacuous.
    expect(startupKeys.length).toBeGreaterThan(0)
    expect(startupKeys.filter((key) => !RESERVED.has(key))).toEqual([])
  })

  it('lists nothing the create schema no longer has', () => {
    expect(
      AGENT_LAUNCH_RESERVED_CREATE_FIELDS.filter((field) => !CREATE_KEYS.includes(field))
    ).toEqual([])
  })

  it('reserves the create payload’s own idempotency key', () => {
    // `agent.launch` dedupes on `clientOperationId`, and `buildManagedWorktreeCreateArgs` never
    // reads `clientMutationId`, so a copy left in the forwarded payload is inert while still
    // reading as an idempotency guarantee. Stripping it is what makes the payload honest — not a
    // second dedupe being disarmed, which is what an earlier version of this comment claimed.
    expect(AGENT_LAUNCH_RESERVED_CREATE_FIELDS).toContain('clientMutationId')
  })

  it('deliberately lets createdWithAgent through', () => {
    // Provenance, not placement: it records which agent a workspace was made for, and the launch's
    // own worktree factory overwrites it with the launched agent regardless. Stripping it would
    // only lose a caller's value without changing where the agent lands. Not an oversight.
    expect(CREATE_KEYS).toContain('createdWithAgent')
    expect(AGENT_LAUNCH_RESERVED_CREATE_FIELDS).not.toContain('createdWithAgent')
  })
})
