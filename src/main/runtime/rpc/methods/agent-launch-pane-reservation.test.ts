/**
 * The pane a caller reserves for the terminal `agent.launch` creates.
 *
 * A client that places its own tabs mints the pane id first and records where the tab should go
 * under it; the host still reveals the tab, and the renderer finds the placement by that id. So the
 * only thing that crosses the wire is identity — and the outcome's `paneKey` says which pane really
 * exists, so a caller whose reservation lost (older host, replay, structured route) can tell.
 */

import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import {
  CAPABLE_CLIENT,
  STRUCTURED_PREFERENCE,
  methodNamed,
  rpcContext,
  runtimeStub,
  type AgentLaunchRuntimeStub as RuntimeStub
} from './agent-launch.test-fixture'

vi.mock('./structured-agent-session-create', () => ({
  createStructuredAgentSessionForWorktree: async () => ({
    ok: true,
    value: { sessionId: 'sess-1' }
  })
}))

const { AGENT_LAUNCH_METHODS } = await import('./agent-launch')
const AGENT_LAUNCH = methodNamed(AGENT_LAUNCH_METHODS, 'agent.launch')

const TAB_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const LEAF_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`

/** No structured preference, so every launch here settles as a terminal unless it says otherwise. */
const TERMINAL_ONLY = {}

const EXISTING_LAUNCH = { agent: 'claude', target: { kind: 'existing', worktree: 'id:wt-7' } }
const CREATE_LAUNCH = {
  agent: 'claude',
  target: { kind: 'create-worktree', create: { repo: 'id:repo-1', name: 'task' } }
}

async function launch(params: unknown, runtime: RuntimeStub, context: Partial<RpcContext> = {}) {
  const parsed = AGENT_LAUNCH.params.safeParse(params)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid')
  }
  return AGENT_LAUNCH.handler(parsed.data, rpcContext(runtime, { ...CAPABLE_CLIENT, ...context }))
}

function terminalOptions(runtime: RuntimeStub): Record<string, unknown> {
  return runtime.createTerminal.mock.calls[0]?.[1] ?? {}
}

describe('a launch into an existing workspace', () => {
  it('creates the terminal under the pane the caller reserved', async () => {
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    await launch({ ...EXISTING_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(terminalOptions(runtime)).toMatchObject({ tabId: TAB_ID, leafId: LEAF_ID })
  })

  it('leaves the pane to the runtime when the caller reserved none', async () => {
    // Every shipped caller sends nothing; its options must not gain a key.
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    await launch(EXISTING_LAUNCH, runtime)

    expect(terminalOptions(runtime)).not.toHaveProperty('tabId')
    expect(terminalOptions(runtime)).not.toHaveProperty('leafId')
  })

  it('keeps the reservation through a downgrade from structured to terminal', async () => {
    const runtime = runtimeStub({
      settings: STRUCTURED_PREFERENCE,
      createSupport: { supported: false, reason: 'wsl' }
    })

    const result = await launch({ ...EXISTING_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(result.receipt).toMatchObject({ mode: 'terminal' })
    expect(terminalOptions(runtime)).toMatchObject({ tabId: TAB_ID, leafId: LEAF_ID })
  })

  it('creates no terminal for a launch the host settles as a chat', async () => {
    // The reservation simply goes unused; the structured outcome tells the caller to burn it.
    const runtime = runtimeStub({ settings: STRUCTURED_PREFERENCE })

    const result = await launch({ ...EXISTING_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(result.outcome.kind).toBe('structured')
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('creates no terminal when it reuses a running one', async () => {
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    const result = await launch(
      { ...EXISTING_LAUNCH, paneKey: PANE_KEY, reuseTerminal: { handle: 'term_live' } },
      runtime
    )

    expect(runtime.createTerminal).not.toHaveBeenCalled()
    expect(result.outcome).toEqual({ kind: 'terminal', handle: 'term_live' })
  })
})

describe('a reserved pane that is already live', () => {
  // The runtime attaches to a live pane rather than spawning, which is right for `terminal.create`
  // but here would report an agent that never started and paste into whatever runs there.
  it('refuses the launch and delivers no prompt', async () => {
    // An agent that takes its prompt as a paste after start, so a missing refusal would reach it.
    const runtime = runtimeStub({ settings: TERMINAL_ONLY, terminalIsReattach: true })
    const prompt = {
      waitForTerminal: vi.fn(async () => ({ satisfied: true })),
      sendTerminalAgentPrompt: vi.fn(async () => true)
    }
    Object.assign(runtime, prompt)

    await expect(
      launch(
        {
          ...EXISTING_LAUNCH,
          agent: 'aider',
          paneKey: PANE_KEY,
          prompt: { text: 'hi', delivery: 'submit' }
        },
        runtime
      )
    ).rejects.toThrow('agent_launch_pane_already_live')
    expect(prompt.waitForTerminal).not.toHaveBeenCalled()
    expect(prompt.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('launches normally when the runtime spawned a fresh pane', async () => {
    const runtime = runtimeStub({ settings: TERMINAL_ONLY, terminalPaneKey: PANE_KEY })

    const result = await launch({ ...EXISTING_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(result.outcome).toEqual({ kind: 'terminal', handle: 'term_1', paneKey: PANE_KEY })
  })
})

describe('a launch that creates its workspace', () => {
  it('carries the reservation to the startup terminal the create spawns', async () => {
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    await launch({ ...CREATE_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(runtime.createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ startupPaneKey: PANE_KEY })
    )
  })

  it('sends no startup pane when the caller reserved none', async () => {
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    await launch(CREATE_LAUNCH, runtime)

    expect(runtime.createManagedWorktree.mock.calls[0]?.[0]).not.toHaveProperty('startupPaneKey')
  })

  it('keeps the reservation out of the worktree.create payload', async () => {
    // A sibling of the payload, like the other startup inputs: it names this launch's pane, not
    // something a `worktree.create` caller can ask for.
    const runtime = runtimeStub({ settings: TERMINAL_ONLY })

    await launch({ ...CREATE_LAUNCH, paneKey: PANE_KEY }, runtime)

    expect(runtime.createManagedWorktree.mock.calls[0]?.[0]).not.toHaveProperty('paneKey')
  })
})

describe('the reservation at the wire', () => {
  it.each([
    ['no leaf', TAB_ID],
    ['a leaf that is not a UUID', `${TAB_ID}:leaf-1`],
    ['an empty tab id', `:${LEAF_ID}`],
    ['an extra separator', `${TAB_ID}:${LEAF_ID}:x`]
  ])('refuses a pane key with %s rather than letting the runtime mint silently', (_, paneKey) => {
    expect(AGENT_LAUNCH.params.safeParse({ ...EXISTING_LAUNCH, paneKey }).success).toBe(false)
  })

  it('accepts a well-formed pane key', () => {
    expect(AGENT_LAUNCH.params.safeParse({ ...EXISTING_LAUNCH, paneKey: PANE_KEY }).success).toBe(
      true
    )
  })
})
