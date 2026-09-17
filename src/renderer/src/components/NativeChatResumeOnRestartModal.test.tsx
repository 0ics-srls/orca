// @vitest-environment happy-dom

import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../store'
import { getDefaultSettings } from '../../../shared/constants'
import { NativeChatResumeOnRestartModal } from './NativeChatResumeOnRestartModal'
import type { ResumeCandidate } from './native-chat-resume-on-restart-grouping'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: rpc
}))
vi.mock('sonner', () => ({ toast: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const offered: ResumeCandidate[] = ['a', 'b'].map((sessionId) => ({
  sessionId,
  workspaceId: 'workspace',
  agent: 'codex',
  trigger: 'quit',
  latestPrompt: `Prompt ${sessionId}`,
  recordedAt: 1_800_000_000_000,
  executionHostId: 'local',
  workspaceKind: 'git-worktree'
}))

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === text
  )
  if (!found) {
    throw new Error(`Missing button: ${text}`)
  }
  return found
}

function checkbox(index: number): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>('[role="checkbox"]')[index]
  if (!found) {
    throw new Error(`Missing checkbox: ${index}`)
  }
  return found
}

beforeEach(() => {
  rpc.mockReset()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    settings: { ...getDefaultSettings(''), experimentalStructuredNativeChat: true },
    updateSettings: async (changes) => {
      useAppStore.setState((state) => ({
        settings: { ...getDefaultSettings(''), ...state.settings, ...changes }
      }))
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

it.each([
  ['Reconnect 1', 'agentSession.restartResume'],
  ['Reconnect and continue', 'agentSession.restartContinue'],
  ['Not now', 'agentSession.restartResumableDismiss']
])('keeps next-launch preference out of the current %s action', async (label, method) => {
  const action = Promise.withResolvers<unknown>()
  rpc.mockImplementation(async (_target, calledMethod) => {
    if (calledMethod === 'agentSession.restartResumable') {
      return { sessions: offered }
    }
    return action.promise
  })
  await act(async () => root.render(<NativeChatResumeOnRestartModal />))
  await act(async () => checkbox(1).click())
  await act(async () => checkbox(2).click())
  await act(async () => button(label).click())
  expect(useAppStore.getState().settings?.nativeChatResumeWorkOnRestart).toBe(true)
  expect(rpc.mock.calls.map((call) => [call[1], call[2]])).toEqual([
    ['agentSession.restartResumable', undefined],
    [method, method === 'agentSession.restartResumableDismiss' ? {} : { sessionIds: ['a'] }]
  ])
  await act(async () =>
    action.resolve({
      results: [{ sessionId: 'a', outcome: 'resumed' }],
      continued: [{ sessionId: 'a', outcome: 'continued' }]
    })
  )
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('automatically reconnects once when the launch begins opted in', async () => {
  useAppStore.setState({
    settings: {
      ...getDefaultSettings(''),
      experimentalStructuredNativeChat: true,
      nativeChatResumeWorkOnRestart: true
    }
  })
  rpc.mockImplementation(async (_target, method) =>
    method === 'agentSession.restartResumable' ? { sessions: offered } : { results: [] }
  )
  await act(async () =>
    root.render(
      <StrictMode>
        <NativeChatResumeOnRestartModal />
      </StrictMode>
    )
  )
  await act(async () =>
    useAppStore.getState().updateSettings({ nativeChatResumeWorkOnRestart: false })
  )
  await act(async () =>
    useAppStore.getState().updateSettings({ nativeChatResumeWorkOnRestart: true })
  )
  await act(async () =>
    useAppStore.getState().updateSettings({ experimentalStructuredNativeChat: false })
  )
  await act(async () =>
    useAppStore.getState().updateSettings({ experimentalStructuredNativeChat: true })
  )
  expect(rpc.mock.calls.map((call) => [call[1], call[2]])).toEqual([
    ['agentSession.restartResumable', undefined],
    ['agentSession.restartResume', {}]
  ])
})

it('dispatches the selected action while a future preference save is still pending', async () => {
  const saved = Promise.withResolvers<void>()
  useAppStore.setState({ updateSettings: () => saved.promise })
  rpc.mockImplementation(async (_target, method) =>
    method === 'agentSession.restartResumable' ? { sessions: offered } : { results: [] }
  )
  await act(async () => root.render(<NativeChatResumeOnRestartModal />))
  await act(async () => checkbox(1).click())
  await act(async () => checkbox(2).click())
  await act(async () => button('Reconnect 1').click())
  expect(rpc.mock.calls.at(-1)?.slice(1)).toEqual([
    'agentSession.restartResume',
    { sessionIds: ['a'] }
  ])
  await act(async () => saved.reject(new Error('settings write failed')))
  expect(rpc).toHaveBeenCalledTimes(2)
})
