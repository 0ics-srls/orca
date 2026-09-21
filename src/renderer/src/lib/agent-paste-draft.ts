import { waitForAgentDraftInputReadyOnTab } from './agent-draft-pty-binding'
import { waitForAgentComposerReady } from './agent-composer-readiness'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { resolveDraftPasteReadyTimeoutMs } from '../../../shared/draft-paste-ready-timeout'
import { useAppStore } from '@/store'
import {
  inspectRuntimeTerminalProcess,
  sendRuntimePtyInputVerified
} from '@/runtime/runtime-terminal-inspection'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START
} from '@/components/terminal-pane/terminal-bracketed-paste'
import { runTerminalPtyInputTransaction } from '@/components/terminal-pane/terminal-pty-input-transaction'
import { waitForAgentReady } from './agent-ready-wait'
import { getSettingsForWorktreeRuntimeOwner } from './worktree-runtime-owner'
import { sendAgentDraftPasteContentNow } from './agent-draft-paste-content'
import { agentDeliversDraftViaNativePrefill } from './agent-native-draft-prefill'
import { waitForAgentDraftInputReady } from './agent-draft-readiness'
import { isExpectedAgentProcess } from '../../../shared/agent-process-recognition'
export {
  AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES,
  AGENT_DRAFT_PASTE_DIRECT_MAX_BYTES,
  AGENT_DRAFT_PASTE_MAX_BYTES,
  chunkAgentDraftPasteContent,
  iterateAgentDraftPasteContentChunks,
  sendAgentDraftPasteContent
} from './agent-draft-paste-content'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Pi /
// OpenCode / Gemini / cursor-agent / copilot) treat the inserted text as a
// single atomic paste instead of echoing character-by-character or triggering
// line-edit shortcuts. Callers choose whether to append Enter after the paste.
export const BRACKETED_PASTE_BEGIN = BRACKETED_PASTE_START
export { BRACKETED_PASTE_END }
export const POST_PASTE_SUBMIT_DELAY_MS = 50

// Binding and composer readiness have separate budgets; Windows binding can exceed eight seconds.
const PTY_SPAWN_TIMEOUT_MS = 8000

export function getSettingsForAgentTabRuntimeOwner(
  tabId: string
): Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined {
  const store = useAppStore.getState()
  for (const [worktreeId, tabs] of Object.entries(store.tabsByWorktree ?? {})) {
    if (tabs?.some((tab) => tab.id === tabId)) {
      // Why: legacy remote PTY ids may not embed their runtime owner. The tab's
      // worktree still identifies which host should receive readiness/send RPCs.
      return getSettingsForWorktreeRuntimeOwner(store, worktreeId)
    }
  }
  return store.settings
}

/**
 * Wait until the agent on `tabId` has rendered its input-accepting TUI,
 * then bracketed-paste `content` into its input buffer. By default the
 * draft stays editable; `submit: true` appends Enter after the paste.
 *
 * Returns true when the paste was issued, false on timeout or missing
 * PTY. `onTimeout` lets the caller surface a UI hint (e.g. toast) when
 * the agent doesn't reach a ready state. `timeoutMs` overrides the
 * readiness budget only; waiting for the PTY to spawn keeps its own budget.
 *
 * Configured agents require the host's cursor-aware composer evidence. Legacy
 * providers retain their stream readiness signals.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  content: string
  agent?: TuiAgent
  submit?: boolean
  forcePaste?: boolean
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, content, agent, submit, forcePaste, timeoutMs, onTimeout } = args

  const agentConfig = agent ? TUI_AGENT_CONFIG[agent] : null

  // Why: agents with a native draft prefill mechanism (flag or env var)
  // launch with the URL already in their input box. Pasting again would
  // duplicate it. Callers should not invoke this helper for those agents;
  // the early return guards against accidental double-injection if a stale
  // call slips through.
  if (agentDeliversDraftViaNativePrefill(agent, forcePaste)) {
    return false
  }

  const readySignal = agentConfig?.draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  const readinessTimeoutMs = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const readiness = await waitForAgentDraftInputReadyOnTab({
    tabId,
    spawnTimeoutMs:
      agentConfig?.draftPasteReadiness === 'host-composer'
        ? Math.max(PTY_SPAWN_TIMEOUT_MS, readinessTimeoutMs)
        : PTY_SPAWN_TIMEOUT_MS,
    readinessTimeoutMs,
    agent,
    readySignal,
    settings
  })
  if (!readiness) {
    onTimeout?.()
    return false
  }

  const { ptyId } = readiness
  if (!readiness.ready) {
    if (agentConfig?.draftPasteReadiness === 'host-composer') {
      onTimeout?.()
      return false
    }
    // Why: fast-starting TUIs can emit the paste-ready escape sequence before
    // this sidecar subscription attaches. If process/title inspection says the
    // launched agent owns the PTY, fall back to a best-effort paste instead of
    // silently dropping generated prompts.
    const fallbackReady = agentConfig
      ? await waitForAgentReady(tabId, agentConfig.expectedProcess, { timeoutMs: 1000 })
      : { ready: false }
    if (!fallbackReady.ready) {
      onTimeout?.()
      return false
    }
  }

  return await sendBracketedPasteToAgent({
    settings,
    ptyId,
    content,
    submit: submit === true,
    agent,
    ...(agent && agentConfig?.draftPasteReadiness === 'host-composer'
      ? {
          beforePaste: () =>
            waitForAgentComposerReady(agent, tabId, ptyId, readinessTimeoutMs, settings)
        }
      : {})
  })
}

export async function pasteDraftToAgentPtyWhenReady(args: {
  tabId: string
  ptyId: string
  content: string
  agent?: TuiAgent
  submit?: boolean
  forcePaste?: boolean
  timeoutMs?: number
  onTimeout?: () => void
}): Promise<boolean> {
  const { tabId, ptyId, content, agent, submit, forcePaste, timeoutMs, onTimeout } = args
  const agentConfig = agent ? TUI_AGENT_CONFIG[agent] : null

  if (agentDeliversDraftViaNativePrefill(agent, forcePaste)) {
    return false
  }

  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  const readySignal = agentConfig?.draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
  const budget = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const ready =
    agent && agentConfig?.draftPasteReadiness === 'host-composer'
      ? await waitForAgentComposerReady(agent, tabId, ptyId, budget, settings)
      : await waitForAgentDraftInputReady(ptyId, budget, readySignal, settings)
  if (!ready) {
    if (agentConfig?.draftPasteReadiness === 'host-composer') {
      onTimeout?.()
      return false
    }
    const fallbackReady = agentConfig
      ? await waitForExpectedAgentOnPty(ptyId, agentConfig.expectedProcess, 1000, settings)
      : false
    if (!fallbackReady) {
      onTimeout?.()
      return false
    }
  }

  return await sendBracketedPasteToAgent({
    settings,
    ptyId,
    content,
    submit: submit === true,
    agent,
    ...(agent && agentConfig?.draftPasteReadiness === 'host-composer'
      ? { beforePaste: () => waitForAgentComposerReady(agent, tabId, ptyId, budget, settings) }
      : {})
  })
}

export async function submitPromptToAgentPty(args: {
  tabId: string
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({
    settings: getSettingsForAgentTabRuntimeOwner(args.tabId),
    ptyId: args.ptyId,
    content: args.content,
    submit: true
  })
}

export async function sendBracketedPasteToRunningAgent(args: {
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({ ptyId: args.ptyId, content: args.content, submit: true })
}

async function sendBracketedPasteToAgent(args: {
  settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  ptyId: string
  content: string
  submit: boolean
  agent?: TuiAgent
  beforePaste?: () => Promise<boolean>
}): Promise<boolean> {
  const { settings = useAppStore.getState().settings, ptyId, content, submit, agent } = args
  const submitRetryDelayMs = agent ? TUI_AGENT_CONFIG[agent]?.submitRetryDelayMs : undefined
  try {
    // Why: paste + Enter (+ retry Enter) must be one transaction, or a concurrent
    // paste on this PTY can slip between them and submit a half-written prompt.
    return await runTerminalPtyInputTransaction(ptyId, async () => {
      if (args.beforePaste && !(await args.beforePaste())) {
        return false
      }
      const pasted = await sendAgentDraftPasteContentNow(settings, ptyId, content)
      if (!pasted || !submit) {
        return pasted
      }

      // Why: Claude Code can leave a prompt as editable text when paste-end and
      // Enter arrive in the same PTY write. Split the submit into the next turn so
      // the TUI processes bracketed-paste termination before handling Enter.
      await new Promise<void>((resolve) => window.setTimeout(resolve, POST_PASTE_SUBMIT_DELAY_MS))
      const submitted = await sendRuntimePtyInputVerified(settings, ptyId, '\r')

      if (submitRetryDelayMs !== undefined) {
        // Why: agents that render their composer before Enter is live silently eat
        // the first Enter; the retry is best-effort and never downgrades `submitted`.
        await new Promise<void>((resolve) => window.setTimeout(resolve, submitRetryDelayMs))
        try {
          await sendRuntimePtyInputVerified(settings, ptyId, '\r')
        } catch {
          // Why: a rejected retry leaves the first Enter's verdict untouched.
        }
      }

      return submitted
    })
  } catch {
    return false
  }
}

async function waitForExpectedAgentOnPty(
  ptyId: string,
  expectedProcess: string,
  timeoutMs: number,
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const process = await withDeadline(
        inspectRuntimeTerminalProcess(settings, ptyId),
        Math.max(0, deadline - Date.now())
      )
      if (!process) {
        return false
      }
      const foreground = process.foregroundProcess?.toLowerCase() ?? ''
      if (isExpectedAgentProcess(foreground, expectedProcess)) {
        return true
      }
    } catch {
      // Ignore transient PTY inspection failures and keep polling.
    }
    const delayMs = Math.min(120, Math.max(0, deadline - Date.now()))
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
    }
  }
  return false
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  if (timeoutMs <= 0) {
    return Promise.resolve(null)
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}
