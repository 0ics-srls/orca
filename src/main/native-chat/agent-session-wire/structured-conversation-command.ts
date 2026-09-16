import { createHash } from 'node:crypto'
import type {
  AgentSessionConversationCommand,
  AgentSessionConversationCommandResult
} from '../../../shared/agent-session-conversation-command'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import { admitAndRunAgentSessionMutation } from './structured-agent-session-mutation-admission'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import type { StructuredAgentSessionCaller } from './structured-agent-session-host-types'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import { conversationCommandBlocked } from './structured-conversation-command-admission'
import { attachConversationClearReplacement } from './structured-conversation-clear-replacement'

export type ConversationCommandParams = {
  envelope: AgentSessionMutationEnvelope
  command: AgentSessionConversationCommand
}
export type ConversationReplacement = {
  sourceSessionId: string
  sessionId: string
  workspaceId: string
  agent: 'claude' | 'codex'
}

type ConversationCommandControl = {
  isCancelled: () => boolean
  beginProviderCall: () => boolean
  endProviderCall: () => void
}

const CANCELLED_BEFORE_PROVIDER = 'Conversation operation was cancelled before provider execution.'

function cancelledBeforeProvider() {
  return {
    ok: false as const,
    refusal: {
      code: 'agent_session_operation_invalid' as const,
      message: CANCELLED_BEFORE_PROVIDER
    }
  }
}

export function runStructuredConversationCommand(
  context: StructuredAgentSessionMutationContext,
  host: Pick<StructuredAgentSessionHost, 'attach' | 'flushStreamedEvents'>,
  caller: StructuredAgentSessionCaller,
  params: ConversationCommandParams,
  control?: ConversationCommandControl
): Promise<AgentSessionMutationResult<AgentSessionConversationCommandResult>> {
  const { envelope, command } = params
  const { sessionId, clientOperationId } = envelope
  const store = context.deps.store
  const matching = () => {
    const record = store.getRecord(sessionId)?.conversationCommand
    return record?.operationId === clientOperationId && record.callerKey === caller.callerKey
      ? record
      : null
  }
  return context.serialize(sessionId, () =>
    admitAndRunAgentSessionMutation({
      store,
      adapter: context.deps.adapter,
      callerKey: caller.callerKey,
      envelope,
      journal: context.sessions.get(sessionId)?.journal,
      publish: (journal) => context.publish(sessionId, journal),
      flushStreamedEvents: context.flushStreamedEvents,
      now: context.now,
      plan: {
        method: 'agentSession.conversationCommand',
        fields: { command },
        recoverUnknownFromDurableState: true,
        settledOutcome: (value) => ({ status: 'succeeded', sessionId, conversationCommand: value }),
        replay: (_ctx, outcome) => {
          if (outcome.status === 'succeeded' && outcome.conversationCommand) {
            return outcome.conversationCommand
          }
          const prior = matching()
          if (prior?.phase === 'committed') {
            return prior
          }
          if (command === 'compact' && prior && outcome.status !== 'unknown') {
            return {
              command,
              state: 'unknown',
              error: 'Compaction completion is unconfirmed; it was not run again.'
            }
          }
          return outcome.status === 'succeeded' && command === 'compact'
            ? { command, state: 'completed' }
            : null
        },
        rerunWhenReplayMissing: () => command === 'clear' && matching()?.phase === 'prepared',
        run: async (ctx) => {
          await host.flushStreamedEvents(sessionId)
          if (control?.isCancelled()) {
            return cancelledBeforeProvider()
          }
          const record = store.getRecord(sessionId)!
          const interruptedClear = record.conversationCommand
          const prior =
            matching() ??
            (command === 'clear' &&
            interruptedClear?.command === 'clear' &&
            interruptedClear.phase === 'prepared' &&
            interruptedClear.runtimeFence !== ctx.fence
              ? interruptedClear
              : null)
          const supersededOperation =
            prior && prior.operationId !== clientOperationId ? prior : null
          const settleSupersededOperation = async (
            value: AgentSessionConversationCommandResult
          ): Promise<void> => {
            if (!supersededOperation) {
              return
            }
            await store.recordOperationOutcome({
              callerKey: supersededOperation.callerKey,
              operationId: supersededOperation.operationId,
              outcome: { status: 'succeeded', sessionId, conversationCommand: value }
            })
          }
          const blocked =
            prior?.phase === 'prepared' && command === 'clear'
              ? null
              : conversationCommandBlocked(ctx, record)
          if (blocked) {
            return {
              ok: false,
              refusal: { code: 'agent_session_operation_invalid', message: blocked }
            }
          }
          const replacementSessionId =
            command === 'clear'
              ? (prior?.replacementSessionId ??
                `clear-${createHash('sha256')
                  .update(JSON.stringify([sessionId, caller.callerKey, clientOperationId]))
                  .digest('hex')
                  .slice(0, 40)}`)
              : undefined
          const prepared = {
            command,
            runtimeFence: ctx.fence,
            operationId: clientOperationId,
            callerKey: caller.callerKey,
            phase: 'prepared' as const,
            state: 'unknown' as const,
            ...(replacementSessionId ? { replacementSessionId } : {})
          }
          let effectiveOptions = record.options
          if (command === 'clear' && !prior) {
            try {
              const options = await ctx.adapter.readOptions?.({ sessionId, fence: ctx.fence })
              effectiveOptions = {
                ...record.options,
                ...(options
                  ? {
                      model: options.current.model,
                      ...(options.current.effort ? { effort: options.current.effort } : {})
                    }
                  : {})
              }
            } catch {
              return {
                ok: false,
                refusal: {
                  code: 'agent_session_operation_invalid',
                  message:
                    'Could not read the current session configuration. Try again when the provider is connected.'
                }
              }
            }
          }
          if (effectiveOptions && command === 'clear') {
            await ctx.persistOptions(effectiveOptions)
          }
          if (control?.isCancelled()) {
            return cancelledBeforeProvider()
          }
          await store.setConversationCommand(sessionId, ctx.fence, prepared)
          let error: string | undefined
          if (command === 'clear' && replacementSessionId) {
            const attachError = await attachConversationClearReplacement({
              host,
              store,
              sourceSessionId: sessionId,
              replacementSessionId,
              callerKey: prior?.callerKey ?? caller.callerKey,
              operationId: prior?.operationId ?? clientOperationId,
              source: { ...record, options: effectiveOptions }
            })
            if (attachError) {
              const failed = {
                ...prepared,
                replacementSessionId: undefined,
                phase: 'committed' as const,
                state: 'completed' as const,
                error: attachError.slice(0, 4096)
              }
              await store.setConversationCommand(sessionId, ctx.fence, failed)
              await settleSupersededOperation(failed)
              return { ok: true, value: failed }
            }
          } else {
            if (!ctx.adapter.compact) {
              throw new Error('Compaction is unavailable for this provider.')
            }
            const identity = {
              provider: 'orca' as const,
              clientMessageId: `compact:${clientOperationId}`
            }
            await ctx.journal.appendItem(
              identity,
              {
                kind: 'status',
                text: 'Compacting conversation…',
                turnLifecycle: { turnId: `compact:${clientOperationId}`, state: 'running' }
              },
              { fence: ctx.fence }
            )
            ctx.publish()
            if (control && !control.beginProviderCall()) {
              error = CANCELLED_BEFORE_PROVIDER
            } else {
              try {
                error = (
                  await ctx.adapter.compact({
                    turnId: `compact:${clientOperationId}`,
                    sessionId,
                    fence: ctx.fence,
                    onLateResult: (result) =>
                      context.serialize(sessionId, async () => {
                        if (
                          matching()?.phase !== 'prepared' ||
                          context.sessions.get(sessionId)?.journal !== ctx.journal
                        ) {
                          return
                        }
                        await host.flushStreamedEvents(sessionId)
                        await ctx.journal.appendItem(
                          identity,
                          { kind: 'status', text: result.error ?? 'Conversation compacted.' },
                          { fence: ctx.fence }
                        )
                        await store.setConversationCommand(sessionId, ctx.fence, {
                          ...prepared,
                          phase: 'committed',
                          state: 'completed',
                          ...(result.error ? { error: result.error.slice(0, 4096) } : {})
                        })
                        await store.recordOperationOutcome({
                          callerKey: caller.callerKey,
                          operationId: clientOperationId,
                          outcome: {
                            status: 'succeeded',
                            sessionId,
                            conversationCommand: matching()!
                          }
                        })
                        ctx.publish()
                      })
                  })
                ).error
                control?.endProviderCall()
                await host.flushStreamedEvents(sessionId)
              } catch (cause) {
                control?.endProviderCall()
                await ctx.journal.appendItem(
                  identity,
                  { kind: 'status', text: 'Compaction completion is unconfirmed.' },
                  { fence: ctx.fence }
                )
                ctx.publish()
                throw cause
              }
            }
            await ctx.journal.appendItem(
              identity,
              { kind: 'status', text: error ?? 'Conversation compacted.' },
              { fence: ctx.fence }
            )
            ctx.publish()
          }
          const completed = {
            ...prepared,
            phase: 'committed' as const,
            state: 'completed' as const,
            ...(error ? { error: error.slice(0, 4096) } : {})
          }
          await store.setConversationCommand(sessionId, ctx.fence, completed)
          await settleSupersededOperation(completed)
          return { ok: true, value: completed }
        }
      }
    })
  )
}
