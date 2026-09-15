import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import type { HookInstallAgent } from '../../shared/telemetry-events'
import { ampHookService } from '../amp/hook-service'
import { antigravityHookService } from '../antigravity/hook-service'
import { claudeHookService } from '../claude/hook-service'
import { codexHookService } from '../codex/hook-service'
import { commandCodeHookService } from '../command-code/hook-service'
import { copilotHookService } from '../copilot/hook-service'
import { cursorHookService } from '../cursor/hook-service'
import { devinHookService } from '../devin/hook-service'
import { droidHookService } from '../droid/hook-service'
import { geminiHookService } from '../gemini/hook-service'
import { grokHookService } from '../grok/hook-service'
import { hermesHookService } from '../hermes/hook-service'
import { kimiHookService } from '../kimi/hook-service'
import { openClaudeHookService } from '../openclaude/hook-service'

// Why (#16441): Codex's installer awaits a codex app-server trust-grant session
// instead of blocking the main thread on spawnSync. Widening the tuple keeps the
// other thirteen agent services synchronous — the shared loop already awaits.
export type ManagedAgentHookInstallOptions = { userInitiated?: boolean; cliVersion?: string }
export type ManagedAgentHookInstaller = readonly [
  HookInstallAgent,
  (
    options?: ManagedAgentHookInstallOptions
  ) => AgentHookInstallStatus | Promise<AgentHookInstallStatus>
]
export type ManagedAgentHookScriptRefresher = readonly [HookInstallAgent, () => Promise<void>]
export type ManagedAgentHookRemover = readonly [
  HookInstallAgent,
  () => AgentHookInstallStatus | Promise<AgentHookInstallStatus>
]
export type ManagedAgentHookAsyncRemover = readonly [
  HookInstallAgent,
  () => Promise<AgentHookInstallStatus>
]
export type ManagedAgentHookStatusReader = readonly [HookInstallAgent, () => AgentHookInstallStatus]

/**
 * The complete lifecycle for one vendor integration.  The tuple exports below
 * remain as a compatibility projection for older callers, but new lifecycle
 * code should consume this descriptor so install, refresh, remove and status
 * cannot silently drift into different vendor lists.
 */
export type ManagedAgentIntegration = {
  readonly agent: HookInstallAgent
  readonly install: (
    options?: ManagedAgentHookInstallOptions
  ) => AgentHookInstallStatus | Promise<AgentHookInstallStatus>
  readonly refreshManagedScripts?: () => Promise<void>
  readonly remove: () => AgentHookInstallStatus | Promise<AgentHookInstallStatus>
  readonly removeAsync?: () => Promise<AgentHookInstallStatus>
  readonly getStatus: () => AgentHookInstallStatus
}

export const MANAGED_AGENT_INTEGRATIONS: readonly ManagedAgentIntegration[] = [
  {
    agent: 'claude',
    install: (options) => claudeHookService.install({ claudeVersion: options?.cliVersion }),
    refreshManagedScripts: () => claudeHookService.refreshManagedScripts(),
    remove: () => claudeHookService.remove(),
    getStatus: () => claudeHookService.getStatus()
  },
  {
    agent: 'openclaude',
    install: () => openClaudeHookService.install(),
    refreshManagedScripts: () => openClaudeHookService.refreshManagedScripts(),
    remove: () => openClaudeHookService.remove(),
    getStatus: () => openClaudeHookService.getStatus()
  },
  {
    agent: 'codex',
    install: () => codexHookService.install(),
    refreshManagedScripts: () => codexHookService.refreshManagedScripts(),
    remove: () => codexHookService.remove(),
    getStatus: () => codexHookService.getStatus()
  },
  {
    agent: 'gemini',
    install: () => geminiHookService.install(),
    refreshManagedScripts: () => geminiHookService.refreshManagedScripts(),
    remove: () => geminiHookService.remove(),
    getStatus: () => geminiHookService.getStatus()
  },
  {
    agent: 'antigravity',
    install: () => antigravityHookService.install(),
    refreshManagedScripts: () => antigravityHookService.refreshManagedScripts(),
    remove: () => antigravityHookService.remove(),
    getStatus: () => antigravityHookService.getStatus()
  },
  {
    agent: 'amp',
    install: () => ampHookService.install(),
    remove: () => ampHookService.remove(),
    getStatus: () => ampHookService.getStatus()
  },
  {
    agent: 'cursor',
    install: () => cursorHookService.install(),
    refreshManagedScripts: () => cursorHookService.refreshManagedScripts(),
    remove: () => cursorHookService.remove(),
    getStatus: () => cursorHookService.getStatus()
  },
  {
    agent: 'droid',
    install: () => droidHookService.install(),
    refreshManagedScripts: () => droidHookService.refreshManagedScripts(),
    remove: () => droidHookService.remove(),
    getStatus: () => droidHookService.getStatus()
  },
  {
    agent: 'command-code',
    install: () => commandCodeHookService.install(),
    refreshManagedScripts: () => commandCodeHookService.refreshManagedScripts(),
    remove: () => commandCodeHookService.remove(),
    getStatus: () => commandCodeHookService.getStatus()
  },
  {
    agent: 'grok',
    install: (options) => grokHookService.install(options),
    refreshManagedScripts: () => grokHookService.refreshManagedScripts(),
    remove: () => grokHookService.remove(),
    removeAsync: () => grokHookService.removeAsync(),
    getStatus: () => grokHookService.getStatus()
  },
  {
    agent: 'copilot',
    install: () => copilotHookService.install(),
    refreshManagedScripts: () => copilotHookService.refreshManagedScripts(),
    remove: () => copilotHookService.remove(),
    getStatus: () => copilotHookService.getStatus()
  },
  {
    agent: 'hermes',
    install: () => hermesHookService.install(),
    remove: () => hermesHookService.remove(),
    getStatus: () => hermesHookService.getStatus()
  },
  {
    agent: 'devin',
    install: () => devinHookService.install(),
    refreshManagedScripts: () => devinHookService.refreshManagedScripts(),
    remove: () => devinHookService.remove(),
    getStatus: () => devinHookService.getStatus()
  },
  {
    agent: 'kimi',
    install: () => kimiHookService.install(),
    refreshManagedScripts: () => kimiHookService.refreshManagedScripts(),
    remove: () => kimiHookService.remove(),
    getStatus: () => kimiHookService.getStatus()
  }
]

// Compatibility projections for the existing IPC and remote installer tests.
// They are derived from the descriptor and therefore cannot acquire a vendor
// independently of the lifecycle entry above.
export const MANAGED_AGENT_HOOK_INSTALLERS: readonly ManagedAgentHookInstaller[] =
  MANAGED_AGENT_INTEGRATIONS.map((integration) => [integration.agent, integration.install] as const)

// Why: covers the shared launcher/statusline scripts under ~/.orca/agent-hooks — the files a
// user-wide agent config keeps invoking after the CLI falls off PATH. Amp and Hermes write
// provider-native plugin code into their own config dirs with their own install lifecycles,
// not shared launchers, so they are deliberately absent. Enforced by the coverage test in
// managed-hook-script-refresh.test.ts: a new installer that writes a launcher without adding
// a refresher here fails that test.
export const MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS: readonly ManagedAgentHookScriptRefresher[] =
  MANAGED_AGENT_INTEGRATIONS.flatMap((integration) =>
    integration.refreshManagedScripts
      ? ([[integration.agent, integration.refreshManagedScripts]] as const)
      : []
  )

export const MANAGED_AGENT_HOOK_REMOVERS: readonly ManagedAgentHookRemover[] =
  MANAGED_AGENT_INTEGRATIONS.map((integration) => [integration.agent, integration.remove] as const)

export const MANAGED_AGENT_HOOK_ASYNC_REMOVERS: readonly ManagedAgentHookAsyncRemover[] =
  MANAGED_AGENT_INTEGRATIONS.flatMap((integration) =>
    integration.removeAsync ? ([[integration.agent, integration.removeAsync]] as const) : []
  )

export const MANAGED_AGENT_HOOK_STATUS_READERS: readonly ManagedAgentHookStatusReader[] =
  MANAGED_AGENT_INTEGRATIONS.map(
    (integration) => [integration.agent, integration.getStatus] as const
  )
