import { Play } from 'lucide-react'
import { Button } from './ui/button'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { CompactAgentExpansion } from '@/components/sidebar/worktree-card-compact-agents'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../store'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

/**
 * The offered chats, grouped by worktree the way the sidebar presents them.
 *
 * Only the presentational pieces are reused — `RepoIconGlyph`, `CompactAgentExpansion`, `AgentIcon`
 * and `formatShortTimeAgo`. The sidebar's own agent row cannot be: it takes `DashboardAgentRow`,
 * which requires a live pane, tab and status entry, and every chat here is by definition stopped.
 *
 * No state dot, deliberately. Every `AgentDotState` would mislead: `idle` and `unverifiable` both
 * presuppose a live pane, `interrupted` renders red like an error, `done` green, `working` a
 * spinner. A missing dot beats a dot that says these agents are running.
 *
 * No host chip either: `DashboardHostBadge` renders only for ssh/remote hosts, and structured chat
 * is local-only, so it would always be empty. It is the right element to add when that changes.
 */

export type ResumeCandidate = {
  sessionId: string
  workspaceId: string
  agent: 'claude' | 'codex'
  trigger: 'quit' | 'update'
  latestPrompt: string
  recordedAt: number
}

type StoreState = ReturnType<typeof useAppStore.getState>

/** The same id space automation dispatch resolves: a folder workspace by its full `folder:<uuid>`
 *  key, a git worktree by its bare `repoId::path` id. */
function resolveWorkspaceWorktree(store: StoreState, workspaceId: string) {
  const scope = parseWorkspaceKey(workspaceId)
  return scope?.type === 'folder'
    ? store.getKnownWorktreeById(workspaceId)
    : store.allWorktrees().find((entry) => entry.id === workspaceId)
}

/** Selectors return primitives or store-owned references, so repeated runs cannot churn equality. */
function useWorkspaceIdentity(workspaceId: string) {
  const displayName = useAppStore(
    (store) => resolveWorkspaceWorktree(store, workspaceId)?.displayName ?? workspaceId
  )
  const repoId = useAppStore(
    (store) => resolveWorkspaceWorktree(store, workspaceId)?.repoId ?? null
  )
  const repoIcon = useAppStore((store) =>
    repoId ? (store.repos.find((entry) => entry.id === repoId)?.repoIcon ?? null) : null
  )
  return { displayName, repoIcon }
}

function ResumeCandidateRow({
  candidate,
  listedAt,
  busy,
  onReconnect
}: {
  candidate: ResumeCandidate
  listedAt: number
  busy: boolean
  onReconnect: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 py-0.5">
      <AgentIcon agent={agentTypeToIconAgent(candidate.agent)} size={14} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {candidate.latestPrompt.trim() ||
            translate('auto.components.NativeChatResumeOnRestartModal.untitled', 'Untitled chat')}
        </p>
      </div>
      {/* `formatShortTimeAgo` takes (timestamp, now) and subtracts internally — NOT a delta. */}
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatShortTimeAgo(candidate.recordedAt, listedAt)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2"
        disabled={busy}
        onClick={onReconnect}
      >
        <Play className="size-3" />
        {translate('auto.components.NativeChatResumeOnRestartModal.resume', 'Reconnect')}
      </Button>
    </li>
  )
}

function WorkspaceGroup({
  workspaceId,
  candidates,
  listedAt,
  busy,
  showHeading,
  onReconnect
}: {
  workspaceId: string
  candidates: ResumeCandidate[]
  listedAt: number
  busy: boolean
  showHeading: boolean
  onReconnect: (sessionId: string) => void
}): React.JSX.Element {
  const { displayName, repoIcon } = useWorkspaceIdentity(workspaceId)
  const rows = (
    <ul className="flex flex-col">
      {candidates.map((candidate) => (
        <ResumeCandidateRow
          key={candidate.sessionId}
          candidate={candidate}
          listedAt={listedAt}
          busy={busy}
          onReconnect={() => onReconnect(candidate.sessionId)}
        />
      ))}
    </ul>
  )
  // One worktree needs no heading — a name, a count and a chevron wrapped around a single group
  // says nothing the dialog has not already said.
  if (!showHeading) {
    return rows
  }
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <RepoIconGlyph repoIcon={repoIcon} className="size-3.5" iconClassName="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{displayName}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {candidates.length === 1
            ? translate('auto.components.NativeChatResumeOnRestartModal.oneAgent', '1 agent')
            : translate(
                'auto.components.NativeChatResumeOnRestartModal.manyAgents',
                '{{value0}} agents',
                { value0: candidates.length }
              )}
        </span>
      </div>
      {/* The sidebar's own collapse mechanics: grid transition, inert when closed, and children
          kept mounted once opened. Always expanded here — the list IS the decision. */}
      <CompactAgentExpansion expanded contentClassName="pl-1">
        {rows}
      </CompactAgentExpansion>
    </section>
  )
}

/** Groups in the order the host offered them, so the list is stable across re-renders. */
export function groupResumeCandidates(
  candidates: readonly ResumeCandidate[]
): { workspaceId: string; candidates: ResumeCandidate[] }[] {
  const groups = new Map<string, ResumeCandidate[]>()
  for (const candidate of candidates) {
    const existing = groups.get(candidate.workspaceId)
    if (existing) {
      existing.push(candidate)
    } else {
      groups.set(candidate.workspaceId, [candidate])
    }
  }
  return [...groups].map(([workspaceId, entries]) => ({ workspaceId, candidates: entries }))
}

export function ResumeOnRestartGroups({
  candidates,
  listedAt,
  busy,
  onReconnect
}: {
  candidates: ResumeCandidate[]
  listedAt: number
  busy: boolean
  onReconnect: (sessionId: string) => void
}): React.JSX.Element {
  const groups = groupResumeCandidates(candidates)
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <WorkspaceGroup
          key={group.workspaceId}
          workspaceId={group.workspaceId}
          candidates={group.candidates}
          listedAt={listedAt}
          busy={busy}
          showHeading={groups.length > 1}
          onReconnect={onReconnect}
        />
      ))}
    </div>
  )
}
