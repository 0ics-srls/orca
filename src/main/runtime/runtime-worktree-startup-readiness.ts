import { withTimeout } from './runtime-async-boundaries'
import { isShellProcess } from '../../shared/agent-detection'
import { isExpectedAgentProcess } from '../../shared/agent-process-recognition'
import { createDraftPasteReadyScanner } from '../../shared/draft-paste-ready-scanner'
import { resolveDraftPasteReadyTimeoutMs } from '../../shared/draft-paste-ready-timeout'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { TuiAgent } from '../../shared/tui-agent'
import type {
  WorktreeStartupDraftPaste,
  WorktreeStartupFollowup
} from './runtime-worktree-agent-startup'

const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'
const BRACKETED_PASTE_QUIET_MS = 1500

export type WorktreeStartupReadinessHost = {
  getPtyId: (handle: string) => string | null
  getForegroundProcess: (ptyId: string) => Promise<string | null>
  hasChildProcesses?: (ptyId: string) => Promise<boolean>
  subscribeToData: (ptyId: string, listener: (data: string) => void) => () => void
  readRecentOutput: (ptyId: string) => string | undefined
  readComposerReady?: (handle: string) => Promise<boolean>
  write: (ptyId: string, data: string) => void
}

export function pasteWorktreeStartupDraftWhenReady(
  host: WorktreeStartupReadinessHost,
  handle: string,
  draft: WorktreeStartupDraftPaste
): void {
  void waitForWorktreeStartupDraft(host, handle, draft.agent)
    .then((ptyId) => {
      if (!ptyId) {
        console.warn('[worktree-create] agent did not become ready for draft paste')
        return
      }
      host.write(ptyId, `${BRACKETED_PASTE_BEGIN}${draft.content}${BRACKETED_PASTE_END}`)
    })
    .catch((error) => console.warn('[worktree-create] failed to paste startup draft:', error))
}

export function sendWorktreeStartupFollowupWhenReady(
  host: WorktreeStartupReadinessHost,
  handle: string,
  followup: WorktreeStartupFollowup
): void {
  void waitForWorktreeStartupFollowup(host, handle, followup.expectedProcess)
    .then((ptyId) => {
      if (!ptyId) {
        console.warn('[worktree-create] agent did not become ready for follow-up prompt')
        return
      }
      host.write(ptyId, `${followup.prompt}\r`)
    })
    .catch((error) =>
      console.warn('[worktree-create] failed to send startup follow-up prompt:', error)
    )
}

export async function waitForWorktreeStartupFollowup(
  host: WorktreeStartupReadinessHost,
  handle: string,
  expectedProcess: string
): Promise<string | null> {
  const ptyId = host.getPtyId(handle)
  if (!ptyId) {
    return null
  }
  const composerConfig = Object.values(TUI_AGENT_CONFIG).find(
    (config) =>
      config.expectedProcess === expectedProcess && config.draftPasteReadiness === 'host-composer'
  )
  if (composerConfig) {
    return await waitForStartupComposer(
      host,
      handle,
      ptyId,
      expectedProcess,
      composerConfig.draftPasteReadyTimeoutMs ?? 60_000
    )
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    try {
      const foregroundProcess = await host.getForegroundProcess(ptyId)
      if (isExpectedAgentProcess(foregroundProcess, expectedProcess)) {
        return ptyId
      }
      if (attempt >= 4 && !isShellProcess(foregroundProcess ?? '')) {
        if ((await host.hasChildProcesses?.(ptyId).catch(() => false)) ?? false) {
          return ptyId
        }
      }
    } catch {
      // Ignore transient PTY inspection failures and keep polling.
    }
  }
  return null
}

export function waitForWorktreeStartupDraft(
  host: WorktreeStartupReadinessHost,
  handle: string,
  agent: TuiAgent
): Promise<string | null> {
  const ptyId = host.getPtyId(handle)
  if (!ptyId) {
    return Promise.resolve(null)
  }
  if (TUI_AGENT_CONFIG[agent].draftPasteReadiness === 'host-composer') {
    return waitForStartupComposer(
      host,
      handle,
      ptyId,
      TUI_AGENT_CONFIG[agent].expectedProcess,
      resolveDraftPasteReadyTimeoutMs(agent)
    )
  }
  const signal =
    TUI_AGENT_CONFIG[agent].draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
  return new Promise((resolve) => {
    let settled = false
    const scanner = createDraftPasteReadyScanner(signal)
    let quietTimer: NodeJS.Timeout | null = null
    let hardTimer: NodeJS.Timeout | null = null
    let unsubscribe: (() => void) | null = null
    const finish = (value: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (quietTimer) {
        clearTimeout(quietTimer)
      }
      if (hardTimer) {
        clearTimeout(hardTimer)
      }
      unsubscribe?.()
      resolve(value)
    }
    const observe = (data: string): void => {
      const result = scanner.observe(data)
      if (result.ready) {
        return finish(ptyId)
      }
      if (result.armQuietTimer) {
        if (quietTimer) {
          clearTimeout(quietTimer)
        }
        quietTimer = setTimeout(() => finish(ptyId), BRACKETED_PASTE_QUIET_MS)
      }
    }
    unsubscribe = host.subscribeToData(ptyId, observe)
    const replay = host.readRecentOutput(ptyId)
    if (replay) {
      observe(replay)
    }
    hardTimer = setTimeout(() => finish(null), resolveDraftPasteReadyTimeoutMs(agent))
  })
}

async function waitForStartupComposer(
  host: WorktreeStartupReadinessHost,
  handle: string,
  ptyId: string,
  expectedProcess: string,
  timeoutMs: number
): Promise<string | null> {
  if (!host.readComposerReady) {
    return null
  }
  const deadline = Date.now() + timeoutMs
  while (host.getPtyId(handle) === ptyId && Date.now() < deadline) {
    try {
      if (
        await withTimeout(host.readComposerReady(handle), Math.max(1, deadline - Date.now()), false)
      ) {
        const process = await withTimeout(
          host.getForegroundProcess(ptyId),
          Math.max(1, deadline - Date.now()),
          null
        )
        return host.getPtyId(handle) === ptyId &&
          Date.now() < deadline &&
          isExpectedAgentProcess(process, expectedProcess)
          ? ptyId
          : null
      }
    } catch {
      return null
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  return null
}
