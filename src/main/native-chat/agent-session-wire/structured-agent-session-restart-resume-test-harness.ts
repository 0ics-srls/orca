// Fixtures shared by the restart-resume suites: one durable record, one journal, one marker.
//
// Kept in one place so the predicate suite and the claim suite cannot drift into disagreeing about
// what a resumable session looks like — a divergence there would let one suite pass on a shape the
// other rejects.

import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'

export const SESSION = 'session-working-1'
export const THREAD = 'thread-1'
export const HANDLE_ROOT = `codex:${JSON.stringify(THREAD)}`
export const NOW = 1_700_000_000_000
/** The launch that wrote the markers, and the one reading them. Adjacent by construction. */
export const LAUNCH_PREVIOUS = 'launch-previous'
export const LAUNCH_CURRENT = 'launch-current'

export function turnItem(
  turnId: string,
  state: 'running' | 'completed' | 'interrupted' | 'unverifiable'
): AgentJournalRenderItem {
  return {
    itemId: `turn:${turnId}`,
    revision: 1,
    body: { kind: 'turn', turnId, state },
    sequence: 1,
    observedAt: NOW
  }
}

export function record(overrides: { chain?: AgentSessionRecord['providerHandleChain'] } = {}) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a literal fixture standing in for a durable record; the code under test reads only lease, provider, location and providerHandleChain.
  return {
    schemaVersion: 2,
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'git-worktree'
    },
    provider: 'codex',
    providerHandleChain: overrides.chain ?? [
      {
        linkId: 'link-1',
        handle: { provider: 'codex', threadId: THREAD },
        origin: 'created',
        mintedAtFence: 1,
        observedAt: NOW
      }
    ],
    accountHome: { variable: 'CODEX_HOME', path: '/home/codex' },
    lease: {
      sessionId: SESSION,
      runtimeKind: 'native',
      runtimeFence: 1,
      handoffStage: null,
      provenHandleLinkId: null,
      ownerProcess: null,
      reservedSpawnToken: null,
      leaseDeadlineAt: NOW,
      lastRenewedAt: NOW,
      handoffOperationId: null,
      journalCheckpoint: null,
      claimKeyId: 'key-1',
      claimStatus: 'released',
      unreconciled: false,
      deathEvidence: null
    },
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as AgentSessionRecord
}

/** The same record with its lease already re-taken, modelling a pane that bound after the offer. */
export function liveLeaseRecord(): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the base fixture is already record-shaped; only claimStatus is overridden.
  return {
    ...record(),
    lease: { ...record().lease, claimStatus: 'live' }
  } as AgentSessionRecord
}

/** A prompt the agent is blocked on. The chat is waiting on the USER, not on itself. */
export function pendingApproval(): AgentJournalRenderItem {
  return {
    itemId: 'approval:1',
    revision: 1,
    body: {
      kind: 'approval',
      title: 'Run the command?',
      detail: null,
      options: [{ id: 'allow', label: 'Allow' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    sequence: 2,
    observedAt: NOW
  }
}

export const CLAUDE_PROVIDER_SESSION = 'prov-session-1'
export const CLAUDE_ROOT = `claude:${JSON.stringify(CLAUDE_PROVIDER_SESSION)}`

/** Claude's handle carries a leaf uuid, and the adapter's close path advances it. */
export function claudeRecord(
  leafUuid: string | null,
  providerSessionId = CLAUDE_PROVIDER_SESSION
): AgentSessionRecord {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the base fixture is already record-shaped; this only swaps the provider and its Claude handle chain.
  return {
    ...record(),
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/claude' },
    providerHandleChain: [
      {
        linkId: 'link-1',
        handle: { provider: 'claude', sessionId: providerSessionId, leafUuid },
        origin: 'created',
        mintedAtFence: 1,
        observedAt: NOW
      }
    ]
  } as unknown as AgentSessionRecord
}

export function journal(
  items: AgentJournalRenderItem[],
  isReadOnly = false,
  submissions: AgentJournalSubmission[] = []
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the code under test calls only isReadOnly, snapshot(), submissions() and appendItem(); a real AgentSessionJournal needs an on-disk SQLite store.
  return {
    isReadOnly,
    snapshot: () => ({ items, submissions }),
    submissions: () => submissions,
    appendItem: async () => undefined
  } as never
}

export function marker(
  overrides: Partial<AgentSessionResumeMarker> = {}
): AgentSessionResumeMarker {
  return {
    sessionId: SESSION,
    work: { kind: 'turn', id: 'turn-1' },
    recordedAt: NOW,
    trigger: 'quit',
    providerHandleRoot: HANDLE_ROOT,
    launchId: LAUNCH_PREVIOUS,
    ...overrides
  }
}

/** A journalled send, in whichever dispatch state the test needs. */
export function submission(
  clientMessageId: string,
  dispatchState: 'pending' | 'accepted' | 'rejected' | 'unknown'
): AgentJournalSubmission {
  return {
    clientMessageId,
    fence: 1,
    payloadFingerprint: 'fp',
    dispatchState,
    providerItemId: null,
    reason: null,
    submittedAt: NOW,
    resolvedAt: null
  }
}
