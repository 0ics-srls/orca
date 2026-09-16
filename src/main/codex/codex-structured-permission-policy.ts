import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolvedTuiAgentArgsBypassPermissions } from '../../shared/tui-agent-launch-defaults'

export type CodexStructuredPermissionPolicy = {
  approvalPolicy: 'never'
  sandbox: 'danger-full-access'
}

/**
 * The Agent Permissions setting as app-server thread policy.
 *
 * Derived per acquisition from the resolved launch arguments, never from the free-text Arguments
 * field: app-server takes a narrower option set than the interactive CLI and the two are versioned
 * apart, so the only thing read out of that field is the posture the toggle stores in it. An
 * untouched profile resolves to the default Orca ships, which is the bypass flag.
 */
export function codexStructuredPermissionPolicyForSettings(
  settings:
    | Partial<Pick<GlobalSettings, 'agentDefaultArgs' | 'terminalWindowsShell'>>
    | null
    | undefined
): CodexStructuredPermissionPolicy | undefined {
  return resolvedTuiAgentArgsBypassPermissions('codex', settings, process.platform)
    ? { approvalPolicy: 'never', sandbox: 'danger-full-access' }
    : undefined
}
