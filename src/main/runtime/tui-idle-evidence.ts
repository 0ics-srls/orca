import type { AgentStatus } from '../../shared/agent-detection'
import { isFreshNonDoneAgentStatus } from '../../shared/agent-status-freshness'
import type { AgentStatusState } from '../../shared/agent-status-types'
import { getAgentReadinessCapability } from '../../shared/agent-readiness-capabilities'
import { resolveExplicitTerminalTitleAgentType } from '../../shared/terminal-title-agent-type'
import type { TuiAgent } from '../../shared/tui-agent'
import { detectExplicitIdleStatusFromTitle } from './terminal-wait-detection'

/**
 * Ranking the evidence that a `tui-idle` wait may settle on.
 *
 * Why a ranking: a thinking TUI and a finished TUI are both silent, so the absence
 * of a working marker can never prove completion. `detectAgentStatusFromTitle`
 * DEFAULTS a name-only agent title to `idle` — the sidebar needs that to clear a
 * stale spinner (#1437) — so a busy Codex/Devin pane is routinely titled idle, and
 * accepting it satisfied a wait in ~0s mid-turn (#6011).
 *
 *   1. READY — the agent states it is ready: an explicit idle marker in its own
 *      title, or a known ready-prompt body.
 *   2. BUSY — a fresh first-party agent status (OSC 9999) saying working/blocked/
 *      waiting. The agent's own account of itself outranks anything inferred.
 *   3. UNKNOWN — a title, screen, or process observation with no provider capability.
 *
 * Why derived here rather than stamped onto the record at write time: `syncWindowGraph`
 * rebuilds every leaf from an explicit field list, so a bespoke provenance field is
 * silently dropped on any renderer publish and the verdict silently flips. `lastOscTitle`
 * is copied, so reading the rank back off it cannot decay.
 */

export type TuiIdleEvidenceRecord = {
  lastAgentStatus: AgentStatus | null
  lastOutputAt: number | null
  lastOscTitle?: string | null
}

export type FirstPartyAgentStatus = { state: AgentStatusState; updatedAt: number } | null

export type TuiIdleObservation = {
  state: 'ready' | 'busy' | 'unsupported' | 'unknown'
  source: 'title' | 'screen' | 'first-party' | 'capability' | 'none'
  agent: TuiAgent | null
}

/** A positive idle marker the agent put in a title itself. */
export function hasExplicitIdleTitle(
  record: TuiIdleEvidenceRecord,
  rendererTitle?: string | null
): boolean {
  // Why lastOscTitle too, not just the renderer's pane title: daemon-hosted and background panes
  // may have no renderer title, while the PTY record still carries the provider's marker.
  for (const title of [rendererTitle, record.lastOscTitle]) {
    if (title && detectExplicitIdleStatusFromTitle(title) === 'idle') {
      return true
    }
  }
  return false
}

/** The agent's own status stream says this turn is still open. */
export function hasFreshWorkingFirstPartyStatus(status: FirstPartyAgentStatus): boolean {
  return isFreshNonDoneAgentStatus(status ?? undefined)
}

function resolveObservedAgent(input: TuiIdleSatisfactionInput): TuiAgent | null {
  if (input.agent) {
    return input.agent
  }
  for (const title of [input.rendererTitle, input.record.lastOscTitle]) {
    if (!title) {
      continue
    }
    const resolved = resolveExplicitTerminalTitleAgentType(title)
    if (resolved) {
      return resolved
    }
  }
  return null
}

function supportsEvidence(agent: TuiAgent | null, source: 'title' | 'screen'): boolean {
  return getAgentReadinessCapability(agent, 'terminal')?.evidence.includes(source) ?? false
}

export type TuiIdleSatisfactionInput = {
  record: TuiIdleEvidenceRecord
  /** Renderer-synced pane/tab title, when one exists. */
  rendererTitle?: string | null
  /** Body evidence: a known ready prompt, or an adopted pane's explicit title.
   *  A thunk because producing it means building the pane's wait text and lowercasing it
   *  (~11us and a multi-KB string on a full tail); the title check below usually answers
   *  first, and then none of that has to happen at all. */
  readPositiveBodyEvidence: () => boolean
  /** Provider identity behind the body evidence, when the scanner can identify it. */
  positiveBodyEvidenceAgent?: TuiAgent | null
  /** Body evidence is normally a rendered terminal preview; adopted title evidence opts in. */
  positiveBodyEvidenceSource?: 'title' | 'screen'
  agent: TuiAgent | null | undefined
  firstPartyStatus: FirstPartyAgentStatus
}

/**
 * Evaluates only evidence that can be tied to this launch's provider. Silence and process
 * presence intentionally have no ready branch: they cannot prove that a composer accepts input.
 */
export function observeTuiIdle(input: TuiIdleSatisfactionInput): TuiIdleObservation {
  // A prompt scanner is itself provider evidence when launch metadata is absent. It is read from
  // this exact attachment, so retaining that identity is safer than treating a known prompt as
  // anonymous and losing a usable readiness fact.
  const agent = resolveObservedAgent(input) ?? input.positiveBodyEvidenceAgent ?? null
  const bodySource = input.positiveBodyEvidenceSource ?? 'screen'
  const bodyAgent = input.positiveBodyEvidenceAgent ?? agent
  if (hasFreshWorkingFirstPartyStatus(input.firstPartyStatus)) {
    return { state: 'busy', source: 'first-party', agent }
  }
  if (hasExplicitIdleTitle(input.record, input.rendererTitle) && supportsEvidence(agent, 'title')) {
    return { state: 'ready', source: 'title', agent }
  }
  if (
    input.readPositiveBodyEvidence() &&
    bodyAgent === agent &&
    supportsEvidence(agent, bodySource)
  ) {
    return { state: 'ready', source: bodySource, agent }
  }
  if (!agent || getAgentReadinessCapability(agent, 'terminal')?.readiness === 'unsupported') {
    return { state: agent ? 'unsupported' : 'unknown', source: 'capability', agent }
  }
  return { state: 'unknown', source: 'none', agent }
}

/** The one place readiness facts are combined; every satisfaction site routes here. */
export function isTuiIdleSatisfied(input: TuiIdleSatisfactionInput): boolean {
  return observeTuiIdle(input).state === 'ready'
}
