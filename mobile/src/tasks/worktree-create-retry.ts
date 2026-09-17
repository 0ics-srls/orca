import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { agentLaunchRun, worktreeCreateRun } from './mobile-workspace-create-operations'
import { waitForRpcClientReconnected } from '../transport/rpc-client-reconnect-wait'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  getGeneratedWorktreeCreateRetryCandidate,
  isRetryableWorktreeCreateConflict
} from '../../../src/shared/new-workspace/worktree-create-retry-policy'
import {
  agentLaunchCreateParams,
  classifyAgentLaunchOperationRefusal,
  isAgentLaunchUnsupportedRefusal,
  readAgentLaunchCreateOutcome,
  type WorktreeCreateAgentLaunch
} from './agent-launch-worktree-create'
import { structuredSessionOperationId } from '../session/structured-session-operation-id'
import { WORKTREE_CREATE_TIMEOUT_MS } from './workspace-create-timeout'
import type { WorkspaceCreateParams } from './workspace-create-params'
import {
  getWorktreeCreateReplayWindowMs,
  type WorktreeCreateIdempotencyProbe,
  type WorktreeCreateIdempotencySupport
} from './worktree-create-idempotency-policy'

// Why: server-side collision checks (branch already exists locally / on a remote
// / already has PR #N) can fire even after a pre-flight basename dedupe —
// branches outlive worktrees in git, and remote branches/PRs aren't visible from
// worktree.ps. Retry by appending -2, -3, ... mirroring the desktop createWorktree
// loop in src/renderer/src/store/slices/worktrees.ts.
export type WorktreeCreateResult =
  | { worktreeId: string; name: string; warning?: string }
  | { error: string }

// Why: a create in flight when the mobile transport migrates (relay/direct
// hand-off on shoddy cellular, relay lease rotation) rejects with a cutover error
// even though the host may have completed it. The shared clientMutationId makes a
// retry idempotent, so re-issue on the fresh session a bounded number of times
// instead of surfacing "RPC interrupted by connection migration" with the
// worktree silently created.
const WORKTREE_CREATE_CUTOVER_MAX_RETRIES = 5

// Why: a connection migration is not the only way a create goes delivery-ambiguous.
// A plain socket close (cellular flap, relay drop, the phone backgrounding and the
// supervisor suspending a billed relay splice) rejects the in-flight frame as
// delivery-unknown with no generation bump, and create holds the longest budget of
// any mobile RPC — 10 minutes of clone/fetch/setup — so it is the likeliest request
// to be caught by one. Surfacing that as a failure is wrong: the host may well have
// finished the worktree. Replay on the same clientMutationId instead.
const WORKTREE_CREATE_AMBIGUOUS_MAX_RETRIES = 2

// Bounded so the Create spinner doesn't sit for the whole window; the deadline still caps it.
export const WORKTREE_CREATE_AMBIGUOUS_RECONNECT_WAIT_MS = 20_000

export type CreateWorktreeWithNameRetryArgs = {
  client: RpcClient
  baseName: string
  nameWasGenerated?: boolean
  buildParams: (name: string) => WorkspaceCreateParams
  worktreeCreateIdempotency: WorktreeCreateIdempotencyProbe
  /** Set when an agent was picked and the host may route the surface. Absent (or an unsupporting
   *  host) leaves `buildParams`' own `startupAgent` to create the worktree agent-first. */
  agentLaunch?: WorktreeCreateAgentLaunch
  maxAttempts?: number
  // Injected in tests; production mints a fresh idempotency key per candidate.
  mintMutationId?: () => string
  // Same partition, same reason: injected in tests, minted per candidate in production.
  mintLaunchOperationId?: () => string
}

// Creates a worktree, retrying with a numeric suffix on a name-collision error.
// buildParams receives the candidate name so callers can assemble source-specific
// params (linked issue/PR, base branch, etc.) around it. Callers that can't clear
// a collision by re-suffixing (e.g. reusing a fixed existing branch) pass
// maxAttempts: 1 to fail fast instead of burning the full retry budget.
export async function createWorktreeWithNameRetry(
  args: CreateWorktreeWithNameRetryArgs
): Promise<WorktreeCreateResult> {
  const { client, baseName, buildParams } = args
  // Why: creating before status.get settles would silently disable safe replay
  // during the exact slow-network window this path is meant to recover from.
  const worktreeCreateIdempotency = await args.worktreeCreateIdempotency
  // Why: the route must settle before the first create, so a name-collision retry cannot land on
  // a different method than the attempt it replaces.
  let launch = await resolveAgentLaunchRoute(args.agentLaunch)
  const maxAttempts = args.maxAttempts ?? CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS
  const mintMutationId = args.mintMutationId ?? defaultWorktreeCreateMutationId
  const mintLaunchOperationId = args.mintLaunchOperationId ?? structuredSessionOperationId
  let lastError: string | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateName = args.nameWasGenerated
      ? getGeneratedWorktreeCreateRetryCandidate(baseName, attempt)
      : getClientWorktreeCreateCandidate(baseName, attempt)
    const candidateParams = buildParams(candidateName)
    // Why: older hosts strip unknown fields, so only stamp and replay when the
    // host advertises idempotency. One key per candidate makes cutover retries
    // safe while a name-collision bump remains a genuinely new create.
    const params = worktreeCreateIdempotency
      ? { ...candidateParams, clientMutationId: mintMutationId() }
      : candidateParams
    // Why here and not inside the sender: the launch fingerprint folds the whole create payload,
    // so an id carried across a name-collision bump would meet its own row under a different
    // fingerprint and refuse `agent_session_operation_conflict` — failing the create outright on
    // the second candidate. One operation per candidate, reused verbatim by every retry within it,
    // is the same partition `clientMutationId` above is minted on.
    let launchOperationId = launch?.replay ? mintLaunchOperationId() : null
    let response = await sendWorktreeCreateResilient(
      client,
      launch?.agent ?? null,
      launchOperationId,
      params,
      worktreeCreateIdempotency
    )
    if (!response.ok && launch && isAgentLaunchUnsupportedRefusal(response.error)) {
      // The probe said the host knows `agent.launch` but it refused the call — most likely this
      // client's capability list had not landed yet. Downgrade for good rather than fail a create.
      launch = null
      launchOperationId = null
      response = await sendWorktreeCreateResilient(
        client,
        null,
        null,
        params,
        worktreeCreateIdempotency
      )
    }
    if (
      !response.ok &&
      launch &&
      launchOperationId &&
      classifyAgentLaunchOperationRefusal(response.error) === 'unadmitted'
    ) {
      // The ledger declined to record the id, which it does before running anything. Re-send the
      // same candidate unnamed so bookkeeping cannot gate the create; this attempt forfeits replay
      // safety, which is what an unsupporting host gives anyway.
      launchOperationId = null
      response = await sendWorktreeCreateResilient(
        client,
        launch.agent,
        null,
        params,
        worktreeCreateIdempotency
      )
    }
    // Why the raw refusal: the retry decision below is `isRetryableWorktreeCreateConflict` over the
    // host's message, and no acceptance policy carries a refusal message through without throwing.
    if (response.ok) {
      const created = readCreateResult(response, launch !== null)
      if (created) {
        return {
          worktreeId: created.worktreeId,
          name: created.displayName?.trim() ? created.displayName : candidateName,
          ...(created.warning ? { warning: created.warning } : {})
        }
      }
      lastError = 'Failed to create workspace'
      break
    }
    lastError = response.error.message
    if (!isRetryableWorktreeCreateConflict(lastError ?? '')) {
      break
    }
  }
  return { error: lastError ?? 'Failed to create workspace' }
}

async function resolveAgentLaunchRoute(
  launch: WorktreeCreateAgentLaunch | undefined
): Promise<{ agent: TuiAgent; replay: boolean } | null> {
  if (!launch) {
    return null
  }
  const support = await launch.supported
  return support ? { agent: launch.agent, replay: support.replay } : null
}

// A launch receipt carries no display name, so the candidate stands in; the session route
// re-resolves the authoritative one from the host either way. Both routes can report a warning:
// a create that seated the workspace but could not start the agent surface.
function readCreateResult(
  response: RpcResponse,
  launched: boolean
): { worktreeId: string; displayName?: string; warning?: string } | null {
  if (launched) {
    return readAgentLaunchCreateOutcome(agentLaunchRun.interpret(response))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  const created = worktreeCreateRun.interpret(response) as {
    worktree?: { id?: unknown; displayName?: unknown }
    warning?: unknown
  } | null
  const worktreeId = created?.worktree?.id
  if (typeof worktreeId !== 'string' || !worktreeId) {
    return null
  }
  const displayName = created?.worktree?.displayName
  // Why: a create can succeed with the startup terminal failing (pty exhaustion); dropping
  // `warning` here is what lands the phone on an unexplained empty session.
  const warning = typeof created?.warning === 'string' ? created.warning.trim() : ''
  return {
    worktreeId,
    ...(typeof displayName === 'string' ? { displayName } : {}),
    ...(warning ? { warning } : {})
  }
}

// Sends the create, re-issuing whenever the request went delivery-ambiguous —
// the frame reached the wire but no response came back, so the host may already have
// built the worktree. Every arm below re-sends the SAME two names: a new one would be a new
// operation and would defeat both mechanisms.
//
// On the `worktree.create` route the shared clientMutationId keeps the retry idempotent host-side.
// On the launch route it does NOT reach the ledger: `agent.launch` caches the whole launch — the
// worktree AND the surface — under that id for 60s, so inside that window a replay adds neither,
// and outside it adds both. `launchOperationId` is what makes the replay durably safe, and it is
// only sent when the host advertised the ledger.
// A definite failure (never sent, or a server error response) is returned to the caller untouched.
async function sendWorktreeCreateResilient(
  client: RpcClient,
  launchAgent: TuiAgent | null,
  launchOperationId: string | null,
  params: WorkspaceCreateParams,
  worktreeCreateIdempotency: WorktreeCreateIdempotencySupport | false
): Promise<RpcResponse> {
  let migrationRetry = 0
  let ambiguousRetry = 0
  const firstSentAt = Date.now()
  let replayDeadlineAt: number | null = null
  for (;;) {
    try {
      // `request` is the transport promise itself, so a delivery-unknown rejection reaches the
      // catch below as the object the transport marked — the WeakSet cannot see through a wrapper.
      return await (launchAgent
        ? agentLaunchRun.request(
            client,
            agentLaunchCreateParams(launchAgent, params, launchOperationId),
            { timeoutMs: WORKTREE_CREATE_TIMEOUT_MS }
          )
        : worktreeCreateRun.request(client, params, {
            timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
          }))
    } catch (error) {
      if (!worktreeCreateIdempotency) {
        throw error
      }
      if (isLogicalClientCutoverError(error)) {
        if (migrationRetry >= WORKTREE_CREATE_CUTOVER_MAX_RETRIES) {
          throw error
        }
        migrationRetry += 1
        // Why: LogicalClientCutoverError is raised only after migrateTo installs an
        // authenticated replacement, so retry immediately instead of adding UI lag.
        continue
      }
      if (!isRpcDeliveryUnknown(error) || ambiguousRetry >= WORKTREE_CREATE_AMBIGUOUS_MAX_RETRIES) {
        throw error
      }
      // Why: every transport path that reports a *drop* leaves 'connected' before the
      // rejection reaches us (rpc-client.ts:675/695/1213 set state first or reject via
      // queueMicrotask; the relay's fail() publishes synchronously). So still being
      // 'connected' here means the socket was healthy the whole time and only the
      // response went missing — the request-timeout path, which surfaces after
      // WORKTREE_CREATE_TIMEOUT_MS. That says nothing about when the host actually
      // resolved, so the dedupe record may be long gone and a replay would build a
      // second worktree instead of reconciling. Fail the create instead.
      if (client.getState() === 'connected') {
        throw error
      }
      // Computed once: a later ambiguity reads a fresher lastInboundAt from the
      // replacement session, which would push the deadline past the record it respects.
      replayDeadlineAt ??= resolveReplayDeadline(client, firstSentAt, worktreeCreateIdempotency)
      const remainingWindowMs = replayDeadlineAt - Date.now()
      if (remainingWindowMs <= 0) {
        throw error
      }
      ambiguousRetry += 1
      // Why: unlike a cutover, no replacement session exists yet — resending now
      // would just hit the dead one, so wait for the transport to come back and
      // surface the original ambiguity if it does not. Clamped to the window so the
      // wait itself cannot carry the replay past the host's record.
      if (
        !(await waitForRpcClientReconnected(
          client,
          Math.min(WORKTREE_CREATE_AMBIGUOUS_RECONNECT_WAIT_MS, remainingWindowMs)
        ))
      ) {
        throw error
      }
    }
  }
}

// Latest instant the host's dedupe record is still guaranteed to exist, from the earliest
// point the create could have resolved. lastInboundAt stamps a frame that really arrived,
// so it stays honest across a suspension in a way a timer budget cannot; the send is the
// fallback, and a sound floor either way, because the host cannot resolve a create it has
// not yet received.
function resolveReplayDeadline(
  client: RpcClient,
  firstSentAt: number,
  support: WorktreeCreateIdempotencySupport
): number {
  const lastInboundAt = client.getLastInboundAt?.() ?? null
  const anchor = lastInboundAt !== null && lastInboundAt > firstSentAt ? lastInboundAt : firstSentAt
  return anchor + getWorktreeCreateReplayWindowMs(support)
}

function defaultWorktreeCreateMutationId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `worktree-create:${Date.now().toString(36)}:${randomPart}`
}
