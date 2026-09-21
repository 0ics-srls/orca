import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { useAppStore } from '@/store'
import { waitForAgentComposerReady } from './agent-composer-readiness'
import { waitForAgentDraftInputReady } from './agent-draft-readiness'

export function waitForAgentDraftInputReadyOnTab(args: {
  tabId: string
  spawnTimeoutMs: number
  readinessTimeoutMs: number
  agent?: TuiAgent
  readySignal: Parameters<typeof waitForAgentDraftInputReady>[2]
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
}): Promise<{ ptyId: string; ready: boolean } | null> {
  return new Promise((resolve) => {
    let selectedPtyId: string | null = null
    let settled = false
    let spawnTimer: number | null = null
    let unsubscribeStore: (() => void) | null = null

    const finish = (result: { ptyId: string; ready: boolean } | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (spawnTimer !== null) {
        window.clearTimeout(spawnTimer)
      }
      unsubscribeStore?.()
      resolve(result)
    }
    const bindPty = (ptyId: string): void => {
      if (selectedPtyId || settled) {
        return
      }
      selectedPtyId = ptyId
      if (spawnTimer !== null) {
        window.clearTimeout(spawnTimer)
      }
      unsubscribeStore?.()
      // Why: Zustand subscribers run inside updateTabPtyId. Registering the
      // sidecar here precedes the transport's immediate pre-handler drain.
      const ready =
        args.agent && TUI_AGENT_CONFIG[args.agent].draftPasteReadiness === 'host-composer'
          ? waitForAgentComposerReady(
              args.agent,
              args.tabId,
              ptyId,
              args.readinessTimeoutMs,
              args.settings
            )
          : waitForAgentDraftInputReady(
              ptyId,
              args.readinessTimeoutMs,
              args.readySignal,
              args.settings
            )
      void ready.then((ready) => finish({ ptyId, ready }))
    }
    const bindFromState = (state: ReturnType<typeof useAppStore.getState>): void => {
      const ptyId = state.ptyIdsByTabId[args.tabId]?.[0]
      if (ptyId) {
        bindPty(ptyId)
      }
    }

    spawnTimer = window.setTimeout(() => finish(null), args.spawnTimeoutMs)
    unsubscribeStore = useAppStore.subscribe(bindFromState)
    bindFromState(useAppStore.getState())
  })
}
