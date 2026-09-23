import { AlertCircle, Check, Clock, X } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { translate } from '@/i18n/i18n'
import {
  resumeFailureGuidance,
  type ResumeFailureAction
} from './native-chat-resume-failure-guidance'
import type { ResumeCandidate, ResumeFailure } from './native-chat-resume-on-restart-grouping'

/**
 * How an acted-on chat ended, laid out like the offered row: provider glyph, the chat's name, model,
 * age — then ONE status icon whose tooltip carries the status and the host's reason. No status text
 * and no second icon: the row already has a glyph on the left, and the outcome is one glance.
 *
 * A failure adds a "To resume" line under the row: one sentence and the button that does it, chosen
 * from the reason. Retry is offered only where a retry can succeed.
 */

export type ResumeOutcome =
  | { kind: 'continued'; candidate: ResumeCandidate }
  | { kind: 'failed'; failure: ResumeFailure }

function actionLabel(action: ResumeFailureAction): string {
  return action === 'open'
    ? translate('auto.components.NativeChatResumeOutcomeRow.openChat', 'Open chat')
    : action === 'retry'
      ? translate('auto.components.NativeChatResumeOutcomeRow.retry', 'Retry')
      : translate('auto.components.NativeChatResumeOutcomeRow.dismiss', 'Dismiss')
}

function StatusIcon({ outcome, title }: { outcome: ResumeOutcome; title: string }) {
  const status =
    outcome.kind === 'continued'
      ? translate(
          'auto.components.NativeChatResumeOutcomeRow.continued',
          'Resumed and asked to continue'
        )
      : outcome.failure.outcome === 'unconfirmed'
        ? translate(
            'auto.components.NativeChatResumeOutcomeRow.unconfirmed',
            'Couldn’t confirm the chat was resumed'
          )
        : translate('auto.components.NativeChatResumeOutcomeRow.failed', 'Couldn’t resume')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable so keyboard users reach the same tooltip; the accessible name says which chat. */}
        <span
          tabIndex={0}
          role="img"
          aria-label={translate(
            'auto.components.NativeChatResumeOutcomeRow.statusFor',
            '{{value0}}: {{value1}}',
            { value0: title, value1: status }
          )}
          className="inline-flex shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {outcome.kind === 'continued' ? (
            <Check className="size-3.5 text-status-success" />
          ) : outcome.failure.outcome === 'unconfirmed' ? (
            <Clock className="size-3.5 text-muted-foreground" />
          ) : (
            <AlertCircle className="size-3.5 text-status-warning" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72">
        {status}
        {outcome.kind === 'failed' && (
          // The code verbatim, so it can be quoted in a report.
          <span className="mt-0.5 block font-mono text-[10px] opacity-75">
            {outcome.failure.reason}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function ResumeOutcomeRow({
  outcome,
  workspaceName,
  listedAt,
  disabled,
  onAction
}: {
  outcome: ResumeOutcome
  /** Named in accessible names: several rows otherwise read identically. */
  workspaceName: string
  listedAt: number
  disabled: boolean
  onAction: (action: ResumeFailureAction, sessionId: string) => void
}): React.JSX.Element {
  const candidate = outcome.kind === 'continued' ? outcome.candidate : outcome.failure
  const agentLabel = formatAgentTypeLabel(candidate.agent)
  const title =
    candidate.latestPrompt.trim() ||
    translate('auto.components.NativeChatResumeOnRestartModal.untitled', 'Untitled chat')
  const model = candidate.model?.trim() ?? ''
  const at = outcome.kind === 'continued' ? candidate.recordedAt : outcome.failure.failedAt
  const guidance = outcome.kind === 'failed' ? resumeFailureGuidance(outcome.failure) : null
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded px-1 py-1">
        <span role="img" aria-label={agentLabel} className="inline-flex shrink-0">
          <AgentIcon agent={agentTypeToIconAgent(candidate.agent)} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        {model && (
          <span
            className="min-w-0 max-w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground"
            title={model}
          >
            {model}
          </span>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatShortTimeAgo(at, listedAt)}
        </span>
        <StatusIcon outcome={outcome} title={title} />
        {outcome.kind === 'failed' && (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={translate(
              'auto.components.NativeChatResumeOutcomeRow.dismissChat',
              'Dismiss "{{value0}}" in {{value1}}',
              { value0: title, value1: workspaceName }
            )}
            onClick={() => onAction('dismiss', candidate.sessionId)}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {guidance && (
        <div className="ml-6 flex items-center gap-2 rounded-md border border-status-warning-border bg-status-warning-background px-2 py-1.5 text-[11px]">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">
              {translate('auto.components.NativeChatResumeOutcomeRow.toResume', 'To resume:')}
            </span>{' '}
            {guidance.text}
          </span>
          <Button
            size="xs"
            disabled={disabled}
            onClick={() => onAction(guidance.primary, candidate.sessionId)}
          >
            {actionLabel(guidance.primary)}
          </Button>
          {guidance.secondary && (
            <Button
              size="xs"
              variant="secondary"
              disabled={disabled}
              onClick={() => onAction(guidance.secondary!, candidate.sessionId)}
            >
              {actionLabel(guidance.secondary)}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
