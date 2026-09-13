import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeHookPayload } from './agent-hook-listener'
import {
  createHookListenerState,
  type HookListenerState
} from './agent-hook-listener/listener-state'
import { PANE_KEY } from './agent-hook-listener-test-harness'

const capturedHooks = readFileSync(
  join(__dirname, '__fixtures__', 'grok-background-completion-hooks.jsonl'),
  'utf8'
)
  .trim()
  .split('\n')
  .map(parseCapturedHook)

function parseCapturedHook(line: string): Record<string, unknown> {
  // JSON.parse returns any; the runtime guard below is what actually proves the shape.
  const parsed: Record<string, unknown> = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Captured Grok hook must be an object')
  }
  return parsed
}

function capturedHook(predicate: (payload: Record<string, unknown>) => boolean) {
  const hook = capturedHooks.find(predicate)
  if (!hook) {
    throw new Error('Captured Grok hook not found')
  }
  return hook
}

describe('Grok completion observations', () => {
  let state: HookListenerState

  beforeEach(() => {
    state = createHookListenerState()
  })

  function normalize(payload: Record<string, unknown>) {
    return normalizeHookPayload(state, 'grok', { paneKey: PANE_KEY, payload }, 'production')
      ?.payload
  }

  // Pins grok-events.ts: shouldAnnounceGrokTerminal finite-task branch; removing the shell/running check must redden.
  it('marks the captured lead Stop silent and the follow-up Stop announceable', () => {
    const lead = normalize(
      capturedHook(
        (hook) =>
          hook.hookEventName === 'stop' && hook.promptId === '8e3fbed9-8839-49a3-8078-0fc261228383'
      )
    )
    const followUp = normalize(
      capturedHook(
        (hook) =>
          hook.hookEventName === 'stop' && String(hook.promptId).startsWith('task-completed-')
      )
    )

    expect(lead).toMatchObject({
      state: 'done',
      completionOutcome: 'succeeded',
      announceCompletion: false
    })
    expect(followUp).toMatchObject({
      state: 'done',
      completionOutcome: 'succeeded',
      announceCompletion: true
    })
  })

  // Pins grok-events.ts: absent backgroundTasks and SessionEnd mapping; defaulting absence open or dropping sessionBoundary must redden.
  it('keeps the captured shutdown SessionEnd and trailing Stop silent', () => {
    const sessionEnd = normalize(
      capturedHook((hook) => hook.hookEventName === 'session_end' && hook.reason === 'shutdown')
    )
    const shutdownStop = normalize(
      capturedHook(
        (hook) =>
          hook.hookEventName === 'stop' &&
          hook.reason === 'shutdown' &&
          !Object.hasOwn(hook, 'backgroundTasks')
      )
    )

    expect(sessionEnd).toMatchObject({
      state: 'done',
      sessionBoundary: true,
      completionOutcome: 'session-ended',
      announceCompletion: false
    })
    expect(shutdownStop).toMatchObject({
      state: 'done',
      completionOutcome: 'succeeded',
      announceCompletion: false
    })
  })

  // Pins grok-events.ts: StopFailure has no background inventory, so its outcome check must win over field absence.
  it('announces the real-shaped StopFailure payload', () => {
    expect(
      normalize({
        hookEventName: 'StopFailure',
        error: 'server_error',
        errorDetails: 'upstream failed',
        lastAssistantMessage: 'The request failed.',
        subagentType: 'primary'
      })
    ).toMatchObject({
      state: 'done',
      completionOutcome: 'failed',
      announceCompletion: true
    })
  })

  // Pins grok-events.ts: StopCancelled has no background inventory, so its outcome check must win over field absence.
  it('announces the real-shaped StopCancelled payload as a non-success outcome', () => {
    expect(
      normalize({
        hookEventName: 'StopCancelled',
        reason: 'user_interrupt',
        cancelledBy: 'user',
        cancelTrigger: 'stop_gesture',
        reasonDetails: 'user interrupted the turn',
        lastAssistantMessage: 'Stopped by user.'
      })
    ).toMatchObject({
      state: 'done',
      completionOutcome: 'cancelled',
      announceCompletion: true,
      interrupted: true,
      lastAssistantMessage: 'Stopped by user.'
    })
  })

  // Pins grok-events.ts: finite task predicate and sessionCrons omission; treating monitors/crons as finite must redden.
  it.each([
    {
      label: 'monitor-only',
      backgroundTasks: [
        { id: 'monitor-1', type: 'monitor', status: 'running', description: 'watch the build' }
      ],
      sessionCrons: []
    },
    {
      label: 'cron-only',
      backgroundTasks: [],
      sessionCrons: [
        { id: 'cron-1', schedule: 'every minute', recurring: true, prompt: 'check the build' }
      ]
    }
  ])('announces when outstanding work is $label', ({ backgroundTasks, sessionCrons }) => {
    expect(
      normalize({
        hookEventName: 'Stop',
        reason: 'end_turn',
        stopHookActive: false,
        backgroundTasks,
        sessionCrons
      })?.announceCompletion
    ).toBe(true)
  })

  // Pins grok-events.ts: strict known-value suppression; treating malformed/unknown optional fields as work must redden.
  it.each([
    { backgroundTasks: { unexpected: true } },
    { backgroundTasks: [{ type: 'future-task', status: 'running' }] },
    { backgroundTasks: [], stopHookActive: 'true' },
    { background_tasks: [], stop_hook_active: false }
  ])('fails open for unknown or legacy optional fields %#', (payload) => {
    expect(
      normalize({
        hookEventName: 'Stop',
        reason: 'end_turn',
        stopHookActive: false,
        ...payload
      })?.announceCompletion
    ).toBe(true)
  })

  // Pins grok-events.ts: stopHookActive strict-true veto; removing that veto must redden.
  it('suppresses a Stop whose Stop hook is keeping the turn active', () => {
    expect(
      normalize({
        hookEventName: 'Stop',
        reason: 'end_turn',
        backgroundTasks: [],
        stopHookActive: true
      })?.announceCompletion
    ).toBe(false)
  })

  // Pins grok-events.ts: type-first Notification guard; removing it or converting idle_prompt/task_complete to done must redden.
  it('does not convert captured typed notifications into successful completions', () => {
    const taskComplete = normalize(
      capturedHook((hook) => hook.notificationType === 'task_complete')
    )
    const idlePrompt = normalize(capturedHook((hook) => hook.notificationType === 'idle_prompt'))
    const idlePromptWithQuestionCopy = normalize({
      hookEventName: 'Notification',
      notificationType: 'idle_prompt',
      message: 'Grok needs your feedback before the next prompt'
    })
    const agentError = normalize({
      hookEventName: 'Notification',
      notificationType: 'agent_error',
      message: 'The agent failed unexpectedly.',
      level: 'error'
    })

    expect(taskComplete).toBeUndefined()
    expect(idlePrompt).toBeUndefined()
    expect(idlePromptWithQuestionCopy).toBeUndefined()
    expect(agentError).toBeUndefined()
  })

  // Pins grok-events.ts: permission/question branch ordering; gating waiting notifications on background work must redden.
  it('leaves the real ask-user-question notification path ungated', () => {
    expect(
      normalize({
        hookEventName: 'Notification',
        notificationType: 'elicitation_dialog',
        message: 'User question requested',
        level: 'info'
      })
    ).toMatchObject({ state: 'waiting', agentType: 'grok' })
  })
})
