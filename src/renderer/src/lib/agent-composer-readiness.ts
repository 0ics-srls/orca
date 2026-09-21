import { withTimeout } from '../../../shared/promise-timeout-fallback'
import type { TuiAgent } from '../../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { TERMINAL_COMPOSER_READINESS_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type {
  RuntimeTerminalResolvePane,
  RuntimeTerminalShow,
  RuntimeTerminalRead
} from '../../../shared/runtime-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { toHostSessionTabId } from '../../../shared/terminal-surface-id'
import { useAppStore } from '@/store'
import { ensureLocalRuntimeCapabilities } from '@/runtime/local-runtime-capabilities'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  hasRuntimeRpcErrorCode,
  runtimeEnvironmentSupportsCapability
} from '@/runtime/runtime-rpc-client'
import { parseRemoteRuntimePtyId } from '../../../shared/remote-runtime-pty-id'

/** The host's recorded-screen classifier owns readiness; shell paste mode is not agent input. */
export async function waitForAgentComposerReady(
  agent: TuiAgent,
  tabId: string,
  ptyId: string,
  timeoutMs: number,
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): Promise<boolean> {
  const remotePty = parseRemoteRuntimePtyId(ptyId)
  const target = remotePty?.environmentId
    ? ({ kind: 'environment', environmentId: remotePty.environmentId } as const)
    : getActiveRuntimeTarget(settings)
  const deadline = Date.now() + timeoutMs
  let observedTerminal: RuntimeTerminalResolvePane | null = null
  const stillOwnsPty = (): boolean =>
    useAppStore.getState().ptyIdsByTabId[tabId]?.includes(ptyId) === true
  try {
    const supported =
      target.kind === 'environment'
        ? await runtimeEnvironmentSupportsCapability(
            target.environmentId,
            TERMINAL_COMPOSER_READINESS_RUNTIME_CAPABILITY,
            Math.min(timeoutMs, 5000)
          )
        : (
            await withTimeout(ensureLocalRuntimeCapabilities(), Math.min(timeoutMs, 5000), null)
          )?.includes(TERMINAL_COMPOSER_READINESS_RUNTIME_CAPABILITY) === true
    if (!supported) {
      return false
    }
    while (stillOwnsPty() && Date.now() < deadline) {
      const layout = useAppStore.getState().terminalLayoutsByTabId[tabId]
      const leafId = Object.entries(layout?.ptyIdsByLeafId ?? {}).find(
        ([, value]) => value === ptyId
      )?.[0]
      if (leafId) {
        const { terminal } = await callRuntimeRpc<{
          terminal: RuntimeTerminalResolvePane | null
        }>(
          target,
          'terminal.resolvePane',
          { paneKey: makePaneKey(toHostSessionTabId(tabId), leafId) },
          { timeoutMs: Math.min(5000, Math.max(1, deadline - Date.now())) }
        ).catch((error: unknown) => {
          if (hasRuntimeRpcErrorCode(error, 'terminal_not_found')) {
            return { terminal: null }
          }
          throw error
        })
        const remoteHandle = remotePty?.handle
        const samePty = remoteHandle ? terminal?.handle === remoteHandle : terminal?.ptyId === ptyId
        if (terminal && samePty && stillOwnsPty()) {
          if (
            observedTerminal &&
            (observedTerminal.handle !== terminal.handle ||
              observedTerminal.incarnationId !== terminal.incarnationId)
          ) {
            return false
          }
          observedTerminal = terminal
          const remaining = deadline - Date.now()
          if (remaining <= 0) {
            return false
          }
          const { terminal: screen } = await callRuntimeRpc<{ terminal: RuntimeTerminalRead }>(
            target,
            'terminal.read',
            { terminal: terminal.handle, screen: true },
            { timeoutMs: Math.min(5000, remaining) }
          )
          if (!stillOwnsPty() || screen.handle !== terminal.handle || screen.status !== 'running') {
            return false
          }
          if (screen.source !== 'screen' || screen.composerReady !== true) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
            continue
          }
          const remainingForIdentity = deadline - Date.now()
          if (remainingForIdentity <= 0) {
            return false
          }
          const { terminal: current } = await callRuntimeRpc<{ terminal: RuntimeTerminalShow }>(
            target,
            'terminal.show',
            { terminal: terminal.handle },
            { timeoutMs: Math.min(5000, remainingForIdentity) }
          )
          return (
            Date.now() < deadline &&
            stillOwnsPty() &&
            current.handle === terminal.handle &&
            current.incarnationId === terminal.incarnationId &&
            current.connected &&
            current.writable &&
            (current.agentIdentity === agent ||
              (TUI_AGENT_CONFIG[agent].expectedProcess === 'claude' &&
                current.agentIdentity === 'claude')) &&
            (remoteHandle ? current.handle === remoteHandle : current.ptyId === ptyId)
          )
        }
      }
      // The PTY can bind before its pane appears in the host's window graph.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100))
    }
  } catch {
    // A disconnected or older host never licenses a best-effort paste.
  }
  return false
}
