import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { StructuredAgentSessionOutboxEntry } from '../../../../shared/structured-agent-session-outbox'
import { Button } from '@/components/ui/button'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'
import type { StructuredSessionBackgroundTasksView } from './structured-session-background-tasks-view'
import { translate } from '@/i18n/i18n'

type StoppingBackgroundTasks = {
  sessionId: string
  taskIds: ReadonlySet<string>
  all: boolean
}

const NO_STOPPING_TASKS: ReadonlySet<string> = new Set()

export function NativeChatStructuredSessionStatus(props: {
  sessionId: string
  error: string | null
  composerError: string | null
  retryableOutboxEntry: StructuredAgentSessionOutboxEntry | null
  onRetry: (clientMessageId: string) => void
  isVisible: boolean
  backgroundTasks: StructuredSessionBackgroundTasksView
  stopBackgroundTask: (taskId?: string) => Promise<unknown>
}): React.JSX.Element {
  const [stopping, setStopping] = useState<StoppingBackgroundTasks | null>(null)
  const [expanded, setExpanded] = useState<{ sessionId: string; expanded: boolean } | null>(null)
  const activeStopping = stopping?.sessionId === props.sessionId ? stopping : null

  const onStop = (taskId?: string) => {
    const sessionId = props.sessionId
    setStopping((current) => {
      const taskIds = new Set(
        current?.sessionId === sessionId ? current.taskIds : NO_STOPPING_TASKS
      )
      if (taskId) {
        taskIds.add(taskId)
      }
      return {
        sessionId,
        taskIds,
        all: taskId ? current?.sessionId === sessionId && current.all : true
      }
    })
    void props.stopBackgroundTask(taskId).finally(() => {
      setStopping((current) => {
        if (current?.sessionId !== sessionId) {
          return current
        }
        const taskIds = new Set(current.taskIds)
        if (taskId) {
          taskIds.delete(taskId)
        }
        const all = taskId ? current.all : false
        return taskIds.size === 0 && !all ? null : { sessionId, taskIds, all }
      })
    })
  }

  return (
    <>
      {props.retryableOutboxEntry ? (
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-1 text-xs text-muted-foreground">
          <span>
            {props.retryableOutboxEntry.state === 'unconfirmed'
              ? translate(
                  'auto.components.native.chat.NativeChatStructuredSession.1f772bb5d0',
                  'Message delivery is unconfirmed.'
                )
              : translate(
                  'auto.components.native.chat.NativeChatStructuredSession.93ef441197',
                  'Message was not sent.'
                )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => props.onRetry(props.retryableOutboxEntry!.clientMessageId)}
          >
            <RotateCcw className="size-3" />
            {translate(
              'auto.components.native.chat.NativeChatStructuredSession.a5e7f14068',
              'Retry'
            )}
          </Button>
        </div>
      ) : null}
      {props.error || props.composerError ? (
        <p className="mx-auto w-full max-w-4xl px-4 py-1 text-xs text-destructive">
          {props.error ?? props.composerError}
        </p>
      ) : null}
      {props.backgroundTasks.show ? (
        <NativeChatBackgroundTasksStatus
          isVisible={props.isVisible}
          tasks={props.backgroundTasks.tasks}
          settledTasks={props.backgroundTasks.settledTasks}
          indicatorActive={props.backgroundTasks.isMonitoring}
          supportsTaskStop={props.backgroundTasks.supportsStop}
          supportsStopAll={props.backgroundTasks.supportsStopAll}
          stoppingTaskIds={activeStopping?.taskIds ?? NO_STOPPING_TASKS}
          stoppingAll={activeStopping?.all ?? false}
          expanded={expanded?.sessionId === props.sessionId && expanded.expanded}
          onExpandedChange={(value) => setExpanded({ sessionId: props.sessionId, expanded: value })}
          onStop={onStop}
        />
      ) : null}
    </>
  )
}
