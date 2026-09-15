import { describe, expect, it } from 'vitest'
import type { AgentChildWorkInput } from './agent-status-child-work'
import { serializeAgentStatusRunAliasIndex } from './agent-status-run-alias-index'
import { createAgentStatusStore } from './agent-status-store'
import { AGENT_STATUS_STORE_LIMITS } from './agent-status-store-contract'
import {
  makePtyRunAgentStatusSubject,
  makeStructuredAgentStatusSubject,
  type AgentStatusExecutionScope
} from './agent-status-subject'

const scope: AgentStatusExecutionScope = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}

function children(parent: ReturnType<typeof makeStructuredAgentStatusSubject>, offset: number) {
  return Array.from({ length: AGENT_STATUS_STORE_LIMITS.mutationEntries / 2 }, (_, index) => {
    const childIndex = offset + index
    return {
      childWorkId: `child-${childIndex}`,
      parent,
      provider: 'claude',
      kind: 'agent',
      state: 'working',
      membership: 'live',
      firstObservedAt: 1,
      observedAt: 1,
      stoppable: true,
      invocation: { invocationId: `invocation-${childIndex}`, generation: 1 },
      provenance: { source: 'structured-session', producerId: 'journal-1' },
      description: 'x'.repeat(8_000)
    } satisfies AgentChildWorkInput
  })
}

describe('AgentStatusStore bounds', () => {
  it('rejects a mutation that would make the aggregate snapshot exceed its byte budget', () => {
    const parent = makeStructuredAgentStatusSubject(scope, 'session-1')
    const store = createAgentStatusStore({ epoch: 'epoch-a', mode: 'authority' })
    expect(store.applyMutation({ parent: { subject: parent } })).not.toBeNull()
    expect(store.applyMutation({ children: children(parent, 0) })).not.toBeNull()

    expect(store.applyMutation({ children: children(parent, 1_024) })).toBeNull()
    expect(store.getSnapshot().children).toHaveLength(1_024)
  })

  it('serializes a derived provider-alias Set above the former 256-run ceiling', () => {
    const store = createAgentStatusStore({ epoch: 'epoch-a', mode: 'authority' })
    for (let index = 0; index < 257; index += 1) {
      const runId = `run-${index}`
      expect(
        store.applyMutation({
          parent: {
            subject: makePtyRunAgentStatusSubject(scope, runId),
            run: {
              runId,
              paneKey: `pane-${index}`,
              attachment: { executionId: `execution-${index}` },
              attribution: 'token',
              providerSessions: [
                {
                  provider: 'claude',
                  sessionKeyKind: 'session_id',
                  providerId: 'shared-provider-id'
                }
              ],
              role: 'root',
              verdict: 'live'
            }
          }
        })
      ).not.toBeNull()
    }

    expect(() => serializeAgentStatusRunAliasIndex(store.getRunAliasIndex())).not.toThrow()
  })
})
