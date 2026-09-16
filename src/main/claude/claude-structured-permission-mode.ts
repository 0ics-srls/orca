import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { StructuredAgentSessionPermissionMode } from '../../shared/structured-agent-session-permission-mode'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolvedTuiAgentArgsBypassPermissions } from '../../shared/tui-agent-launch-defaults'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { ClaudeControlRequestError } from './claude-stream-json-connection'
import { readClaudeSettingsPermissionMode } from './claude-structured-session-options'
import type { ClaudeSession } from './claude-structured-session-state'

/**
 * The Agent Permissions setting as the SDK's own permission mode.
 *
 * Read per acquisition — like the environment overlay and the auth policy beside it — rather than
 * latched into the session record: the setting is the one copy of this fact, so nothing can
 * disagree with it and a failed restore cannot silently downgrade a session to prompting.
 *
 * Yolo still stores itself as the agent's bypass flag inside the launch arguments, which is also
 * what a terminal launch acts on, so presence of that flag is the fact to read — resolved through
 * the same default fallback the terminal uses, which is why an untouched profile bypasses. The
 * rest of the arguments string is a terminal concern this path does not interpret.
 */
export function claudeStructuredPermissionModeForSettings(
  settings:
    | Partial<Pick<GlobalSettings, 'agentDefaultArgs' | 'terminalWindowsShell'>>
    | null
    | undefined
): PermissionMode {
  return resolvedTuiAgentArgsBypassPermissions('claude', settings, process.platform)
    ? 'bypassPermissions'
    : 'default'
}

function restorePermissionModeIntent(
  session: ClaudeSession,
  previousPermissionMode: string | undefined,
  mutationSequence: number
): void {
  if (mutationSequence !== session.permissionModeMutationSequence) {
    return
  }
  if (previousPermissionMode === undefined) {
    session.options.delete('permissionMode')
  } else {
    session.options.set('permissionMode', previousPermissionMode)
  }
  if (
    session.reportedPermissionModeMutation === mutationSequence &&
    session.reportedOptions.permissionMode === previousPermissionMode
  ) {
    session.confirmedOptions.add('permissionMode')
  } else {
    session.confirmedOptions.delete('permissionMode')
  }
}

export async function setClaudeStructuredPermissionMode(
  session: ClaudeSession,
  permissionMode: StructuredAgentSessionPermissionMode,
  timeoutMs: number | undefined,
  failureDisposition: 'rollback' | 'keep-requested' = 'rollback'
): Promise<Readonly<Record<string, string>>> {
  const mutationSequence = ++session.permissionModeMutationSequence
  const previousPermissionMode = session.options.get('permissionMode')
  session.options.set('permissionMode', permissionMode)
  session.confirmedOptions.delete('permissionMode')
  try {
    await session.connection.setPermissionMode(permissionMode, { timeoutMs })
  } catch (error) {
    if (mutationSequence !== session.permissionModeMutationSequence) {
      return Object.fromEntries(session.options)
    }
    if (failureDisposition === 'rollback') {
      restorePermissionModeIntent(session, previousPermissionMode, mutationSequence)
    }
    if (error instanceof ClaudeControlRequestError) {
      throw new AgentSessionOptionRejectedError(error)
    }
    throw error
  }
  const settingsPermissionMode = await session.connection
    .getSettings({ timeoutMs })
    .then(readClaudeSettingsPermissionMode)
    .catch(() => null)
  if (mutationSequence !== session.permissionModeMutationSequence) {
    return Object.fromEntries(session.options)
  }
  if (settingsPermissionMode) {
    session.reportedOptions.permissionMode = settingsPermissionMode
    if (settingsPermissionMode === permissionMode) {
      session.reportedPermissionModeMutation = mutationSequence
      session.confirmedOptions.add('permissionMode')
    } else {
      session.confirmedOptions.delete('permissionMode')
    }
  }
  if (permissionMode === 'plan') {
    return Object.fromEntries(session.options)
  }
  session.options.delete('permissionMode')
  return Object.fromEntries(session.options)
}

export async function restoreClaudePermissionModeAfterApprovedPrompt(
  session: ClaudeSession,
  settleOptions?: (options: Readonly<Record<string, string>>) => Promise<void>,
  timeoutMs?: number
): Promise<void> {
  const restoreValue = session.basePermissionMode
  if (session.options.get('permissionMode') !== 'plan' || !restoreValue) {
    return
  }
  let options: Readonly<Record<string, string>> = Object.fromEntries(session.options)
  let failure: unknown
  try {
    options = await setClaudeStructuredPermissionMode(
      session,
      restoreValue,
      timeoutMs,
      'keep-requested'
    )
  } catch (error) {
    failure = error
    options = Object.fromEntries(session.options)
  }
  try {
    await settleOptions?.(options)
  } catch (error) {
    failure ??= error
  }
  if (failure !== undefined) {
    console.warn('[claude] failed to settle permission mode after ExitPlanMode approval', {
      providerSessionId: session.providerSessionId,
      error: failure
    })
  }
}
