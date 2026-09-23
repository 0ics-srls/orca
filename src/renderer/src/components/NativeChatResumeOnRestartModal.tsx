import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
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
import { translate } from '@/i18n/i18n'
import { activateAiVaultStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { ResumeOnRestartGroups } from './NativeChatResumeOnRestartGroups'
import { ResumeCandidateRow } from './NativeChatResumeOnRestartAgentRow'
import { ResumeOutcomeRow, type ResumeOutcome } from './NativeChatResumeOutcomeRow'
import type { ResumeFailureAction } from './native-chat-resume-failure-guidance'
import type { ResumeCandidate, ResumeFailure } from './native-chat-resume-on-restart-grouping'
import {
  consumeNativeChatResumeOnRestartDialogRequest,
  getNativeChatResumeOnRestartDialogRequest,
  subscribeNativeChatResumeOnRestartDialog
} from './native-chat-resume-on-restart-dialog'
import {
  continueNativeChatRestartOffer,
  dismissNativeChatRestartOffer,
  getNativeChatRestartOffer,
  useNativeChatRestartOffer
} from './native-chat-resume-on-restart-store'

/**
 * What would be resumed, shown before anything runs — and what came of it, shown after.
 *
 * Resuming reattaches a chat AND asks the agent to carry on, so the list is the point: the user
 * sees which chats the last teardown recorded as mid-turn before a message goes anywhere. Every
 * string here has to say that a message is sent and that the user's own prompt is not re-sent.
 *
 * The "don't ask again" box removes the PROMPT, never a safety check — an opted-in launch calls
 * the same RPC, which re-derives the same predicate and staggers the same way.
 *
 * A chat the action could not carry on stays: the dialog remains open with the outcome of every
 * row, and the host keeps the failure so the status bar can reopen this list later. Each failed
 * row says what to do about it.
 *
 * Closing is a SNOOZE, so looking around before deciding cannot remove the recovery. Dismiss is
 * the explicit path that deletes the durable records.
 */

export function NativeChatResumeOnRestartModal(): React.JSX.Element | null {
  const structuredEnabled = useAppStore(
    (store) => store.settings?.experimentalStructuredNativeChat === true
  )
  const { candidates, failed, settled, listedAt } = useNativeChatRestartOffer(structuredEnabled)
  // Open is an external one-shot request, never mirrored into local state: the launch load and the
  // status-bar entry both raise it, and a copy here would go stale against whichever raised it last.
  const open = useSyncExternalStore(
    subscribeNativeChatResumeOnRestartDialog,
    getNativeChatResumeOnRestartDialogRequest,
    getNativeChatResumeOnRestartDialogRequest
  )
  const updateSettings = useAppStore((store) => store.updateSettings)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Which of the OFFERED chats to leave out. Tracked as EXCLUSIONS rather than a selection because
   *  the list is the host's and arrives — and shrinks — under an open dialog; a stored selection
   *  would need seeding from an effect every time it changed. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  /** Derived from the host's own list, so an action can never name a chat it did not offer. */
  const chosen = useMemo(
    () =>
      candidates
        .map((candidate) => candidate.sessionId)
        .filter((sessionId) => !excluded.has(sessionId)),
    [candidates, excluded]
  )
  const selected = useMemo(() => new Set(chosen), [chosen])
  const outcomes = useMemo<ResumeOutcome[]>(
    () => [
      ...settled.map((candidate): ResumeOutcome => ({ kind: 'continued', candidate })),
      ...failed.map((failure): ResumeOutcome => ({ kind: 'failed', failure }))
    ],
    [settled, failed]
  )

  const toggleSelected = useCallback((sessionId: string, checked: boolean) => {
    setExcluded((current) => {
      const next = new Set(current)
      if (checked) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }, [])

  /** Applied on whichever action the user takes, so the box means the same thing every way out. */
  const persistPreference = useCallback(async (): Promise<void> => {
    if (dontAskAgain) {
      await updateSettings({ nativeChatResumeWorkOnRestart: true }).catch(() => undefined)
    }
  }, [dontAskAgain, updateSettings])

  const resume = useCallback(
    async (sessionIds: string[]): Promise<void> => {
      setBusy(true)
      try {
        void persistPreference()
        await continueNativeChatRestartOffer(sessionIds)
      } finally {
        setBusy(false)
        // Stays open when something did not carry on: the failed rows say what to do next, and
        // closing them unseen would leave only a toast that is gone in seconds.
        if (getNativeChatRestartOffer().failed.length === 0) {
          consumeNativeChatResumeOnRestartDialogRequest()
        }
      }
    },
    [persistPreference]
  )

  /** Closing is a snooze: the host keeps the offer and the status bar keeps the way back to it. */
  const snooze = useCallback((): void => {
    consumeNativeChatResumeOnRestartDialogRequest()
    void persistPreference()
  }, [persistPreference])

  const dismissAll = useCallback(async (): Promise<void> => {
    void persistPreference()
    // Bookkeeping never gates the user's own action: the dialog closes here whatever the host
    // answers, rather than being trapped open behind a rejected promise.
    consumeNativeChatResumeOnRestartDialogRequest()
    await dismissNativeChatRestartOffer()
  }, [persistPreference])

  const dismissFailed = useCallback(async (): Promise<void> => {
    consumeNativeChatResumeOnRestartDialogRequest()
    await dismissNativeChatRestartOffer(failed.map((failure) => failure.sessionId))
  }, [failed])

  const actOnFailure = useCallback(
    async (action: ResumeFailureAction, sessionId: string): Promise<void> => {
      if (action === 'open') {
        const failure = failed.find((entry) => entry.sessionId === sessionId)
        if (!failure) {
          return
        }
        // Opening is read-only and leaves the record: the user's own send in that chat is what
        // settles it. The dialog gets out of the way of the chat it just opened.
        consumeNativeChatResumeOnRestartDialogRequest()
        await activateAiVaultStructuredSession({
          structuredSession: { workspaceId: failure.workspaceId, sessionId }
        })
        return
      }
      if (action === 'dismiss') {
        await dismissNativeChatRestartOffer([sessionId])
        return
      }
      setBusy(true)
      try {
        await continueNativeChatRestartOffer([sessionId])
      } finally {
        setBusy(false)
      }
    },
    [failed]
  )

  if (!structuredEnabled || !open || (candidates.length === 0 && outcomes.length === 0)) {
    return null
  }

  const offering = candidates.length > 0
  const interruptedByUpdate = candidates.some((candidate) => candidate.trigger === 'update')

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) {
          snooze()
        }
      }}
    >
      {/* Height is capped, never the data: the list scrolls inside the dialog so the header and
          the primary action stay put however many chats were interrupted. */}
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto_auto] sm:max-w-xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>
            {/* Plain wrapper owns the icon spacing; DialogTitle owns its own. */}
            <span className="flex items-center gap-2">
              {offering ? (
                <RotateCcw className="size-4 text-muted-foreground" />
              ) : (
                <AlertCircle className="size-4 text-status-warning" />
              )}
              {offering
                ? translate(
                    'auto.components.NativeChatResumeOnRestartModal.title',
                    'Resume interrupted chats?'
                  )
                : failed.length === 1
                  ? translate(
                      'auto.components.NativeChatResumeOnRestartModal.notContinuedOne',
                      '1 chat couldn’t be resumed'
                    )
                  : translate(
                      'auto.components.NativeChatResumeOnRestartModal.notContinuedMany',
                      '{{value0}} chats couldn’t be resumed',
                      { value0: failed.length }
                    )}
            </span>
          </DialogTitle>
          <DialogDescription>
            {offering
              ? interruptedByUpdate
                ? translate(
                    'auto.components.NativeChatResumeOnRestartModal.updateBody',
                    'These chats were mid-turn when Orca installed an update. Resuming restores each one where it stopped, with its full context, and asks the agent to check its last action before carrying on. Your own prompt is not re-sent.'
                  )
                : translate(
                    'auto.components.NativeChatResumeOnRestartModal.body',
                    'These chats were mid-turn when Orca closed. Resuming restores each one where it stopped, with its full context, and asks the agent to check its last action before carrying on. Your own prompt is not re-sent.'
                  )
              : translate(
                  'auto.components.NativeChatResumeOnRestartModal.failedBody',
                  'Resumed chats were asked to check their last action before carrying on. A chat that couldn’t be resumed stays here and in the status bar until you open, retry, or dismiss it.'
                )}
          </DialogDescription>
        </DialogHeader>

        <div
          tabIndex={0}
          aria-label={
            offering
              ? translate(
                  'auto.components.NativeChatResumeOnRestartModal.listLabel',
                  'Chats that would be resumed'
                )
              : translate(
                  'auto.components.NativeChatResumeOnRestartModal.outcomeListLabel',
                  'How each chat was resumed'
                )
          }
          className="flex min-h-0 flex-col gap-3 overflow-y-auto scrollbar-sleek rounded-md border bg-muted/35 p-1.5"
        >
          {offering && (
            <ResumeOnRestartGroups
              items={candidates}
              renderRow={(candidate: ResumeCandidate, workspaceName) => (
                <ResumeCandidateRow
                  key={candidate.sessionId}
                  candidate={candidate}
                  workspaceName={workspaceName}
                  listedAt={listedAt}
                  checked={selected.has(candidate.sessionId)}
                  disabled={busy}
                  onCheckedChange={(checked) => toggleSelected(candidate.sessionId, checked)}
                />
              )}
            />
          )}
          {outcomes.length > 0 && (
            <section className="flex flex-col gap-1">
              {offering && (
                // Only needed when both lists share the box; alone, the title already says it.
                <span className="px-0.5 text-[11px] font-medium text-muted-foreground">
                  {translate(
                    'auto.components.NativeChatResumeOnRestartModal.outcomeListLabel',
                    'How each chat was resumed'
                  )}
                </span>
              )}
              <ResumeOnRestartGroups
                items={outcomes.map((outcome) =>
                  outcome.kind === 'continued' ? outcome.candidate : outcome.failure
                )}
                renderRow={(item: ResumeCandidate | ResumeFailure, workspaceName) => {
                  const outcome = outcomes.find((entry) =>
                    entry.kind === 'continued' ? entry.candidate === item : entry.failure === item
                  )
                  return outcome ? (
                    <ResumeOutcomeRow
                      key={`${outcome.kind}:${item.sessionId}`}
                      outcome={outcome}
                      workspaceName={workspaceName}
                      listedAt={listedAt}
                      disabled={busy}
                      onAction={(action, sessionId) => void actOnFailure(action, sessionId)}
                    />
                  ) : null
                }}
              />
            </section>
          )}
        </div>

        {offering ? (
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
                  "Don't ask again (resume automatically)"
                )}
              </span>
              {/* Where to undo it; what it does is the body copy's job. */}
              <span className="block text-xs text-muted-foreground">
                {translate(
                  'auto.components.NativeChatResumeOnRestartModal.dontAskAgainHint',
                  'You can turn this off in Settings → Experimental → Chat UI.'
                )}
              </span>
            </span>
          </label>
        ) : (
          <span />
        )}

        {/* Two controls: one deletes the offer, one acts on it. Closing snoozes, so it needs none. */}
        <DialogFooter className="sm:justify-between">
          {offering ? (
            <>
              {/* Quiet, explicit cleanup of the durable records. */}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void dismissAll()}>
                {translate(
                  'auto.components.NativeChatResumeOnRestartModal.dismissAll',
                  'Dismiss all'
                )}
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={busy || chosen.length === 0}
                onClick={() => void resume(chosen)}
              >
                {busy
                  ? translate(
                      'auto.components.NativeChatResumeOnRestartModal.resuming',
                      'Resuming…'
                    )
                  : chosen.length === 1
                    ? translate(
                        'auto.components.NativeChatResumeOnRestartModal.resumeSelectedOne',
                        'Resume 1 chat'
                      )
                    : translate(
                        'auto.components.NativeChatResumeOnRestartModal.resumeSelected',
                        'Resume {{value0}} chats',
                        { value0: chosen.length }
                      )}
              </Button>
            </>
          ) : (
            // The right action differs per failed row, so there is no blanket Retry here.
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || failed.length === 0}
              onClick={() => void dismissFailed()}
            >
              {translate(
                'auto.components.NativeChatResumeOnRestartModal.dismissFailed',
                'Dismiss failed'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
