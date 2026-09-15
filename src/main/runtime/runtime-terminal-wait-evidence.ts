import type { AgentStatus } from '../../shared/agent-detection'
import type { RuntimeTerminalReadiness } from '../../shared/runtime-types'
import type { TuiAgent } from '../../shared/tui-agent'
import { detectKnownReadyPromptAgent } from './terminal-wait-detection'
import type { RuntimeLeafRecord, RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import {
  observeTuiIdle,
  type FirstPartyAgentStatus,
  type TuiIdleObservation
} from './tui-idle-evidence'

type RuntimeTerminalWaitEvidenceDependencies = {
  getAdoptedPtyIdleStatus(pty: RuntimePtyWorktreeRecord): AgentStatus | null
  getAdoptedPtyTitle?(pty: RuntimePtyWorktreeRecord): string | null
  getTabTitle(tabId: string): string | null
  getPaneAgent(ptyId: string | null | undefined): TuiAgent | null
  getFirstPartyAgentStatus(ptyId: string | null | undefined): FirstPartyAgentStatus
}

export class RuntimeTerminalWaitEvidence {
  constructor(private readonly deps: RuntimeTerminalWaitEvidenceDependencies) {}

  result(observation: TuiIdleObservation): RuntimeTerminalReadiness {
    return {
      state: observation.state,
      source: observation.source,
      ...(observation.agent ? { agent: observation.agent } : {})
    }
  }

  observePty(pty: RuntimePtyWorktreeRecord, waitText: string): TuiIdleObservation {
    const promptAgent = detectKnownReadyPromptAgent(waitText)
    const adoptedIdle = this.deps.getAdoptedPtyIdleStatus(pty) === 'idle'
    const adoptedTitle = this.deps.getAdoptedPtyTitle?.(pty) ?? null
    return observeTuiIdle({
      record: pty,
      rendererTitle: adoptedTitle,
      readPositiveBodyEvidence: () => adoptedIdle || promptAgent !== null,
      positiveBodyEvidenceAgent: promptAgent,
      positiveBodyEvidenceSource: adoptedIdle ? 'title' : 'screen',
      agent: this.deps.getPaneAgent(pty.ptyId),
      firstPartyStatus: this.deps.getFirstPartyAgentStatus(pty.ptyId)
    })
  }

  observeLeaf(leaf: RuntimeLeafRecord, waitText: string): TuiIdleObservation {
    const promptAgent = detectKnownReadyPromptAgent(waitText)
    return observeTuiIdle({
      record: leaf,
      rendererTitle: leaf.paneTitle ?? this.deps.getTabTitle(leaf.tabId),
      readPositiveBodyEvidence: () => promptAgent !== null,
      positiveBodyEvidenceAgent: promptAgent,
      agent: this.deps.getPaneAgent(leaf.ptyId),
      firstPartyStatus: this.deps.getFirstPartyAgentStatus(leaf.ptyId)
    })
  }

  isPtySatisfied(pty: RuntimePtyWorktreeRecord, waitText: string): boolean {
    return this.observePty(pty, waitText).state === 'ready'
  }

  isLeafSatisfied(leaf: RuntimeLeafRecord, waitText: string): boolean {
    return this.observeLeaf(leaf, waitText).state === 'ready'
  }
}
