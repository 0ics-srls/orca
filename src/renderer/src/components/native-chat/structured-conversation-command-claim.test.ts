import { describe, expect, it, vi } from 'vitest'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import {
  StructuredConversationCommandClaim,
  type ConversationCommandReply
} from './structured-conversation-command-claim'

const OPERATION_ID = 'op-1'

function lifecycleItem(
  command: 'clear' | 'compact',
  state: 'running' | 'completed' | 'unverifiable',
  text?: string
): AgentJournalRenderItem {
  return {
    itemId: agentJournalSubmissionKey(`${command}:${OPERATION_ID}`),
    revision: state === 'running' ? 1 : 2,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'status',
      text:
        text ??
        (state === 'running'
          ? `${command === 'compact' ? 'Compacting' : 'Clearing'} conversation…`
          : command === 'compact'
            ? 'Conversation compacted.'
            : 'Conversation cleared.'),
      turnLifecycle: { turnId: `${command}:${OPERATION_ID}`, state }
    }
  }
}

function neverReplies(): Promise<ConversationCommandReply> {
  return new Promise<ConversationCommandReply>(() => {})
}

describe('StructuredConversationCommandClaim', () => {
  it.each(['compact', 'clear'] as const)(
    'settles %s from typed host lifecycle when the reply is lost',
    async (command) => {
      const claim = new StructuredConversationCommandClaim()
      const outcome = claim.run({
        command,
        operationId: OPERATION_ID,
        blocked: false,
        send: neverReplies
      })
      expect(claim.applyStreamSnapshot([lifecycleItem(command, 'running')])).toBe(false)
      expect(claim.applyStreamSnapshot([lifecycleItem(command, 'completed')])).toBe(true)
      await expect(outcome).resolves.toEqual({ accepted: true, error: null })
    }
  )

  it('settles an unverifiable host lifecycle with recovery guidance', async () => {
    const claim = new StructuredConversationCommandClaim()
    const outcome = claim.run({
      command: 'compact',
      operationId: OPERATION_ID,
      blocked: false,
      send: async () => ({ result: { command: 'compact', state: 'unknown' }, unresolved: false })
    })
    await Promise.resolve()
    expect(claim.applyStreamSnapshot([lifecycleItem('compact', 'unverifiable')])).toBe(true)
    await expect(outcome).resolves.toMatchObject({
      accepted: false,
      error: expect.stringContaining('Restart the session')
    })
    expect(claim.isRunning).toBe(false)
  })

  it('preserves a provider failure carried by terminal lifecycle', async () => {
    const claim = new StructuredConversationCommandClaim()
    const outcome = claim.run({
      command: 'compact',
      operationId: OPERATION_ID,
      blocked: false,
      send: neverReplies
    })
    claim.applyStreamSnapshot([
      lifecycleItem('compact', 'completed', 'Provider refused compaction.')
    ])
    await expect(outcome).resolves.toEqual({
      accepted: false,
      error: 'Provider refused compaction.'
    })
  })

  it('retains the operation id for retry when transport returns no reply', async () => {
    const claim = new StructuredConversationCommandClaim()
    await expect(
      claim.run({
        command: 'compact',
        operationId: OPERATION_ID,
        blocked: false,
        send: async () => ({ result: null, unresolved: true })
      })
    ).resolves.toMatchObject({ accepted: false, retrySameOperation: true })
    expect(claim.isRunning).toBe(false)
  })

  it('uses replies from older hosts that publish no typed lifecycle', async () => {
    const claim = new StructuredConversationCommandClaim()
    await expect(
      claim.run({
        command: 'clear',
        operationId: OPERATION_ID,
        blocked: false,
        send: async () => ({ result: { command: 'clear', state: 'completed' }, unresolved: false })
      })
    ).resolves.toEqual({ accepted: true, error: null })
  })

  it('refuses a concurrent command without sending it', async () => {
    const claim = new StructuredConversationCommandClaim()
    const send = vi.fn(neverReplies)
    void claim.run({ command: 'compact', operationId: OPERATION_ID, blocked: false, send })
    await expect(
      claim.run({ command: 'clear', operationId: 'op-2', blocked: false, send })
    ).resolves.toMatchObject({ accepted: false })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
