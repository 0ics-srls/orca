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
  .map((line) => JSON.parse(line) as Record<string, unknown>)

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

  // Pins grok-events.ts: StopFailure bypass; applying the finite-work veto before failure handling must redden.
  it('announces StopFailure even while finite work remains', () => {
    expect(
      normalize({
        hookEventName: 'StopFailure',
        backgroundTasks: [{ type: 'shell', status: 'running' }],
        error: 'api timeout'
      })
    ).toMatchObject({
      state: 'done',
      completionOutcome: 'failed',
      announceCompletion: true
    })
  })

  // Pins grok-events.ts: StopCancelled outcome/interrupted mapping; mapping it to succeeded or suppressing it must redden.
  it('announces StopCancelled as a non-success terminal outcome', () => {
    expect(
      normalize({
        hookEventName: 'StopCancelled',
        backgroundTasks: [{ type: 'subagent', status: 'running' }],
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
      backgroundTasks: [{ type: 'monitor', status: 'running' }],
      sessionCrons: []
    },
    { label: 'cron-only', backgroundTasks: [], sessionCrons: [{ id: 'cron-1' }] }
  ])('announces when outstanding work is $label', ({ backgroundTasks, sessionCrons }) => {
    expect(
      normalize({ hookEventName: 'Stop', backgroundTasks, sessionCrons })?.announceCompletion
    ).toBe(true)
  })

  // Pins grok-events.ts: strict known-value suppression; treating malformed/unknown optional fields as work must redden.
  it.each([
    { backgroundTasks: { unexpected: true } },
    { backgroundTasks: [{ type: 'future-task', status: 'running' }] },
    { backgroundTasks: [], stopHookActive: 'true' },
    { background_tasks: [], stop_hook_active: false }
  ])('fails open for unknown or legacy optional fields %#', (payload) => {
    expect(normalize({ hookEventName: 'Stop', ...payload })?.announceCompletion).toBe(true)
  })

  // Pins grok-events.ts: stopHookActive strict-true veto; removing that veto must redden.
  it('suppresses a Stop whose Stop hook is keeping the turn active', () => {
    expect(
      normalize({ hookEventName: 'Stop', backgroundTasks: [], stopHookActive: true })
        ?.announceCompletion
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
    const staleProse = normalize({ hookEventName: 'Notification', message: 'Type your message' })

    expect(taskComplete).toBeUndefined()
    expect(idlePrompt).toBeUndefined()
    expect(idlePromptWithQuestionCopy).toBeUndefined()
    expect(staleProse).toBeUndefined()
  })

  // Pins grok-events.ts: permission/question branch ordering; gating waiting notifications on background work must redden.
  it('leaves the needs-input notification path ungated', () => {
    expect(
      normalize({
        hookEventName: 'Notification',
        notificationType: 'question',
        message: 'Grok needs your feedback to proceed'
      })
    ).toMatchObject({ state: 'waiting', agentType: 'grok' })
  })
})
