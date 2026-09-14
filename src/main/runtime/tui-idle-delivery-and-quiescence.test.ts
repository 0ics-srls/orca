import { describe, expect, it, vi } from 'vitest'
import { makeTuiIdleRuntime } from './tui-idle-wait-test-harness'
import type { RuntimeSyncWindowGraph } from '../../shared/runtime-types'
import type { OrcaRuntimeService } from './orca-runtime'
import type { TuiAgent } from '../../shared/tui-agent'

// Follow-ons to #6011. The evidence ranking that fixed the wait path did not reach two
// other consumers of the same signal: mailbox delivery, which TYPES INTO the pane, and
// the idle poll's quiescence gate, which read a missing output clock as "never quiet".

const WORKTREE_ID = 'repo-1::/tmp/followups'
const TAB_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'
const LEAF_ID = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'
const PTY_ID = 'pty-followups'
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const osc = (title: string) => `${ESC}]0;${title}${BEL}`

const GRAPH: RuntimeSyncWindowGraph = {
  tabs: [
    { tabId: TAB_ID, worktreeId: WORKTREE_ID, title: 'Agent', activeLeafId: LEAF_ID, layout: null }
  ],
  leaves: [
    {
      tabId: TAB_ID,
      worktreeId: WORKTREE_ID,
      leafId: LEAF_ID,
      paneRuntimeId: 1,
      ptyId: PTY_ID,
      paneTitle: null,
      title: ''
    }
  ]
}

async function makeRuntime(launchAgent: TuiAgent | null, foreground = 'codex') {
  const runtime = makeTuiIdleRuntime({
    repoPath: '/tmp/followups',
    getForegroundProcess: async () => foreground
  })
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, GRAPH)
  runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    incarnationId: 'followups-inc',
    ...(launchAgent ? { agentLaunchAuthority: { launchToken: 'tok', launchAgent } } : {})
  })
  const { terminals } = await runtime.listTerminals(`id:${WORKTREE_ID}`)
  return { runtime, handle: terminals[0].handle }
}

/** Counts real delivery attempts. Spies on the delivery entry point, NOT on the gate
 *  under test — the gate runs for real and decides whether this is ever reached. */
function watchDelivery(runtime: OrcaRuntimeService) {
  return vi
    .spyOn(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the delivery entry point is protected; the spy only needs its name and signature.
      runtime as never as { deliverPendingMessagesForLeaf: (leaf: unknown) => void },
      'deliverPendingMessagesForLeaf'
    )
    .mockImplementation(() => {})
}

describe('mailbox delivery honours the tui-idle evidence ranking', () => {
  it('does not deliver into a pane that is only showing its agent name mid-turn', async () => {
    const { runtime } = await makeRuntime('codex')
    const deliver = watchDelivery(runtime)
    runtime.onPtyData(PTY_ID, `${osc('⠋ Codex')}working\n`, Date.now())
    expect(deliver).not.toHaveBeenCalled()

    // The busy agent repaints its title to the bare product name. That reads as `idle`
    // for display, but it is emitted just as often mid-turn — typing into the pane here
    // injects the pointer plus Enter into a running turn.
    runtime.onPtyData(PTY_ID, `${osc('Codex')}still working\n`, Date.now())
    expect(deliver).not.toHaveBeenCalled()
  })

  it('delivers once the agent states it is done', async () => {
    const { runtime } = await makeRuntime('codex')
    const deliver = watchDelivery(runtime)
    runtime.onPtyData(PTY_ID, `${osc('⠋ Codex')}working\n`, Date.now())
    runtime.onPtyData(PTY_ID, `${osc('Codex ready')}done\n`, Date.now())
    expect(deliver).toHaveBeenCalled()
  })

  it('still delivers for an agent whose name is its only rest signal', async () => {
    const { runtime } = await makeRuntime('grok', 'grok')
    const deliver = watchDelivery(runtime)
    runtime.onPtyData(PTY_ID, `${osc('⠋ Grok')}working\n`, Date.now())
    runtime.onPtyData(PTY_ID, `${osc('grok')}banner\n`, Date.now())
    expect(deliver).toHaveBeenCalled()
  })
})

describe('quiescence treats a missing output clock as quiet', () => {
  it('settles a pane that has never produced output but holds a live agent process', async () => {
    // No launch metadata: Orca did not start this agent, so the quiet-foreground lane is
    // the only evidence available, and `lastOutputAt` is null because nothing ever arrived.
    const { runtime, handle } = await makeRuntime(null, 'codex')
    const leaves =
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reading the runtime's own leaf map to assert the precondition this test depends on.
      (runtime as never as { leaves: Map<string, { lastOutputAt: number | null }> }).leaves
    expect([...leaves.values()][0].lastOutputAt).toBeNull()

    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 8_000 })
    ).resolves.toMatchObject({ condition: 'tui-idle', satisfied: true })
  }, 20_000)
})
