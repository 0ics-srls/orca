import { useCallback, useEffect, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { useAppStore } from '../store'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

/**
 * What would be reconnected, shown before anything runs.
 *
 * The list is the point. Reconnecting a chat that was not working starts a provider the user never
 * asked for and puts a misleading row in front of them, so they see exactly which chats the last
 * teardown recorded as mid-turn and decide. The checkbox is the opt-in to skipping this prompt in
 * future — it removes the PROMPT, never a safety check: automatic mode calls the same RPC, which
 * re-derives the same predicate and staggers the same way.
 *
 * Reconnecting restores the session at the point it stopped; it does NOT continue the interrupted
 * reply — that was measured. Every user-facing string here has to keep saying so.
 *
 * Turning the offer down spends the markers. A prompt that returns at every launch is worse than
 * the problem it solves, and nothing is lost: opening a chat takes a resume-capable hold, which
 * re-acquires the provider at the same cursor.
 */

type ResumeCandidate = {
  sessionId: string
  workspaceId: string
  agent: 'claude' | 'codex'
  trigger: 'quit' | 'update'
  latestPrompt: string
  /** Host clock when teardown recorded the marker; the row shows its age. */
  recordedAt: number
}

type ResumeOutcome = { sessionId: string; outcome: 'resumed' | 'refused' }

// Structured sessions run on the machine hosting the runtime; both launch resolvers refuse anything
// else, so there is no remote target to aim this at.
const LOCAL = { kind: 'local' } as const

function announceResumed(count: number): void {
  if (count <= 0) {
    return
  }
  toast(
    count === 1
      ? translate('auto.components.NativeChatResumeOnRestartModal.resumedOne', 'Reconnected 1 chat')
      : translate(
          'auto.components.NativeChatResumeOnRestartModal.resumedMany',
          'Reconnected {{value0}} chats',
          {
            value0: count
          }
        )
  )
}

/**
 * A workspace id is not a name. `folder:<uuid>` identifies nothing at twenty rows, and recognising
 * which chats would reconnect is the entire point of this list.
 *
 * Resolved the way automation dispatch already resolves the same id space: a folder workspace is
 * keyed by its full `folder:<uuid>` key, a git worktree by its bare `repoId::path` id. Falls back
 * to the id — what the row showed before — when nothing is resolvable, which also covers the window
 * before the worktree store has hydrated.
 */
function useWorkspaceLabel(workspaceId: string): string {
  // Returns a primitive, so the selector re-runs freely without churning referential equality.
  return useAppStore((store) => {
    const scope = parseWorkspaceKey(workspaceId)
    const worktree =
      scope?.type === 'folder'
        ? store.getKnownWorktreeById(workspaceId)
        : store.allWorktrees().find((entry) => entry.id === workspaceId)
    return worktree?.displayName ?? workspaceId
  })
}

/** Its own component because a hook cannot run inside `map`, and the label needs one per row. */
function ResumeOnRestartRow({
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
  const workspaceLabel = useWorkspaceLabel(candidate.workspaceId)
  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {candidate.latestPrompt.trim() ||
            translate('auto.components.NativeChatResumeOnRestartModal.untitled', 'Untitled chat')}
        </p>
        {/* Age matters: the TTL is 24h, so an eight-hour-old offer must not look like one from a
            minute ago. */}
        <p className="truncate text-[11px] text-muted-foreground">
          {`${candidate.agent} · ${workspaceLabel} · ${formatUiRelativeTime(
            candidate.recordedAt - listedAt
          )}`}
        </p>
      </div>
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

export function NativeChatResumeOnRestartModal(): React.JSX.Element | null {
  const structuredEnabled = useAppStore(
    (store) => store.settings?.experimentalStructuredNativeChat === true
  )
  const autoResume = useAppStore((store) => store.settings?.nativeChatResumeWorkOnRestart === true)
  const updateSettings = useAppStore((store) => store.updateSettings)
  const [candidates, setCandidates] = useState<ResumeCandidate[]>([])
  /** Clock stamped when the list arrived. Row ages read against this rather than a render-time
   *  `Date.now()`, so they stay stable across re-renders and the render stays pure. */
  const [listedAt, setListedAt] = useState(0)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    if (!structuredEnabled || resolved) {
      return
    }
    let cancelled = false
    // Fetched after mount, never awaited by startup: the workspace is usable first.
    void (async () => {
      try {
        const offered = await callStructuredAgentSession<{ sessions: ResumeCandidate[] }>(
          LOCAL,
          'agentSession.restartResumable'
        )
        if (cancelled || offered.sessions.length === 0) {
          return
        }
        if (autoResume) {
          // Identical call to the buttons below; the host re-derives eligibility either way.
          const result = await callStructuredAgentSession<{ results: ResumeOutcome[] }>(
            LOCAL,
            'agentSession.restartResume',
            {}
          )
          // Automatic must never be silent: someone who ticked the box months ago still sees this.
          announceResumed(result.results.filter((entry) => entry.outcome === 'resumed').length)
          return
        }
        setListedAt(Date.now())
        setCandidates(offered.sessions)
      } catch {
        // A host that cannot answer offers nothing. There is no failure worth a modal of its own.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [autoResume, resolved, structuredEnabled])

  /** Applied on whichever action the user takes, so the box means the same thing either way. */
  const persistPreference = useCallback(async (): Promise<void> => {
    if (dontAskAgain) {
      await updateSettings({ nativeChatResumeWorkOnRestart: true }).catch(() => undefined)
    }
  }, [dontAskAgain, updateSettings])

  const resume = useCallback(
    async (sessionIds?: string[]): Promise<void> => {
      setBusy(true)
      try {
        await persistPreference()
        const result = await callStructuredAgentSession<{ results: ResumeOutcome[] }>(
          LOCAL,
          'agentSession.restartResume',
          sessionIds ? { sessionIds } : {}
        )
        const settled = new Set(result.results.map((entry) => entry.sessionId))
        const remaining = candidates.filter((candidate) => !settled.has(candidate.sessionId))
        announceResumed(result.results.filter((entry) => entry.outcome === 'resumed').length)
        setCandidates(remaining)
        // An empty result means the host settled none of them — never leave the dialog sitting open
        // behind a button that did nothing.
        if (remaining.length === 0 || result.results.length === 0) {
          setResolved(true)
        }
      } finally {
        setBusy(false)
      }
    },
    [candidates, persistPreference]
  )

  /** Any close is a decline, and a decline spends the markers so this cannot return every launch. */
  const decline = useCallback(async (): Promise<void> => {
    setResolved(true)
    await persistPreference()
    await callStructuredAgentSession(LOCAL, 'agentSession.restartResumableDismiss', {}).catch(
      () => undefined
    )
  }, [persistPreference])

  if (!structuredEnabled || resolved || candidates.length === 0) {
    return null
  }

  const interruptedByUpdate = candidates.some((candidate) => candidate.trigger === 'update')

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) {
          void decline()
        }
      }}
    >
      {/* Height is capped, never the data: seeing WHICH chats would be reconnected is the whole
          point, so the list scrolls inside the dialog while the header and primary action stay. */}
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto_auto] sm:max-w-xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-4 text-muted-foreground" />
            {translate(
              'auto.components.NativeChatResumeOnRestartModal.title',
              'Reconnect interrupted chats?'
            )}
          </DialogTitle>
          <DialogDescription>
            {interruptedByUpdate
              ? translate(
                  'auto.components.NativeChatResumeOnRestartModal.updateBody',
                  'These chats were mid-turn when Orca installed an update. Reconnecting restores each one where it stopped, with its full context and without re-sending your prompt — the interrupted reply will not continue on its own.'
                )
              : translate(
                  'auto.components.NativeChatResumeOnRestartModal.body',
                  'These chats were mid-turn when Orca closed. Reconnecting restores each one where it stopped, with its full context and without re-sending your prompt — the interrupted reply will not continue on its own.'
                )}
          </DialogDescription>
        </DialogHeader>

        <ul
          tabIndex={0}
          aria-label={translate(
            'auto.components.NativeChatResumeOnRestartModal.listLabel',
            'Chats that would be reconnected'
          )}
          className="flex min-h-0 flex-col gap-1 overflow-y-auto scrollbar-sleek rounded-md border bg-muted/35 p-1.5"
        >
          {candidates.map((candidate) => (
            <ResumeOnRestartRow
              key={candidate.sessionId}
              candidate={candidate}
              listedAt={listedAt}
              busy={busy}
              onReconnect={() => void resume([candidate.sessionId])}
            />
          ))}
        </ul>

        {/* Says the quiet part: declining is not destructive, because opening the chat still
            re-acquires it at the same cursor. */}
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.NativeChatResumeOnRestartModal.notNowHint',
            'Not now keeps everything — you can reopen any chat later and carry on from the same point.'
          )}
        </p>

        <label className="flex items-start gap-2.5">
          <Checkbox
            checked={dontAskAgain}
            disabled={busy}
            onCheckedChange={(next) => setDontAskAgain(next === true)}
            className="mt-0.5"
          />
          <span className="min-w-0 space-y-0.5">
            <span className="block text-sm">
              {translate(
                'auto.components.NativeChatResumeOnRestartModal.dontAskAgain',
                "Don't ask again — reconnect automatically next time"
              )}
            </span>
            {/* Spelled out: a bare "don't ask again" reads as "stop bothering me", not as consent
                to run agents unattended. */}
            <span className="block text-xs text-muted-foreground">
              {translate(
                'auto.components.NativeChatResumeOnRestartModal.dontAskAgainHint',
                'Qualifying chats will be reconnected automatically after a restart, and Orca will tell you when it happens. You can turn this off in Settings → Experimental → Chat UI.'
              )}
            </span>
          </span>
        </label>

        <DialogFooter>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void decline()}>
            {translate('auto.components.NativeChatResumeOnRestartModal.notNow', 'Not now')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => void resume(candidates.map((candidate) => candidate.sessionId))}
          >
            {busy
              ? translate(
                  'auto.components.NativeChatResumeOnRestartModal.resuming',
                  'Reconnecting…'
                )
              : translate(
                  'auto.components.NativeChatResumeOnRestartModal.resumeAll',
                  'Reconnect all'
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
