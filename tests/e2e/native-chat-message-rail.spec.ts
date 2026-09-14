// Visual proof for the transcript message rail. The guards for the rail's logic
// are vitest units; this spec exists to render it against a real seeded
// transcript and capture what the reader actually sees.

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'

/** 30 user turns, so the rail is well past its 20-tick sampling cap. */
const TRANSCRIPT_ROWS = 60
const SHOT_DIR = path.join(os.tmpdir(), 'orca-rail-validation-larvacean', 'shots')

async function enableNativeChatSetting(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const nextSettings = await window.api.settings.set({ experimentalNativeChat: true })
    window.__store?.setState({ settings: nextSettings })
  })
}

async function seedClaudeProviderSession(
  page: Page,
  args: { paneKey: string; worktreeId: string; sessionId: string; transcriptPath: string }
): Promise<void> {
  await page.evaluate(({ paneKey, worktreeId, sessionId, transcriptPath }) => {
    window.__store
      ?.getState()
      .setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'e2e message rail probe', agentType: 'claude' },
        'Claude',
        undefined,
        { worktreeId },
        { providerSession: { key: 'session_id', id: sessionId, transcriptPath } }
      )
  }, args)
}

async function toggleTerminalTabToChatView(
  page: Page,
  args: { tabId: string; worktreeId: string }
): Promise<void> {
  await page.evaluate(({ tabId, worktreeId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const unifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!unifiedTab) {
      throw new Error('Unified terminal tab not found for chat toggle')
    }
    state.toggleTabViewMode(unifiedTab.id)
  }, args)
}

function claudeTranscript(rowCount: number, sessionId: string): string {
  const startedAt = Date.now() - rowCount * 1_000
  return `${Array.from({ length: rowCount }, (_, index) => {
    const isUser = index % 2 === 0
    const turn = Math.floor(index / 2)
    const body = isUser
      ? `Question ${turn}: what does the rail do when I scroll a long reply?`
      : Array.from(
          { length: 6 },
          (_unused, line) => `Answer paragraph ${line + 1} for turn ${turn}.`
        ).join('\n\n')
    return JSON.stringify({
      sessionId,
      uuid: `${sessionId}-${index}`,
      timestamp: new Date(startedAt + index * 1_000).toISOString(),
      type: isUser ? 'user' : 'assistant',
      message: {
        role: isUser ? 'user' : 'assistant',
        model: 'claude-opus-4',
        content: [{ type: 'text', text: body }]
      }
    })
  }).join('\n')}\n`
}

test.describe('Native chat message rail', () => {
  test('renders ticks for user messages and previews them on hover', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-message-rail-${randomUUID()}`
    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-native-chat-rail-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)
    writeFileSync(transcriptPath, claudeTranscript(TRANSCRIPT_ROWS, sessionId))
    mkdirSync(SHOT_DIR, { recursive: true })

    await enableNativeChatSetting(orcaPage)
    await seedClaudeProviderSession(orcaPage, {
      paneKey: descriptor.paneKey,
      worktreeId: descriptor.worktreeId,
      sessionId,
      transcriptPath
    })
    await toggleTerminalTabToChatView(orcaPage, { tabId, worktreeId: descriptor.worktreeId })

    await expect(orcaPage.locator('[data-native-chat-root="true"]')).toBeVisible({
      timeout: 15_000
    })
    const transcriptWindow = orcaPage.locator('[data-native-chat-window]')
    await expect(transcriptWindow).toBeVisible({ timeout: 30_000 })

    const rail = orcaPage.locator('[data-native-chat-rail]')
    await expect(rail).toBeVisible({ timeout: 30_000 })

    // Sampling cap: 30 user turns must not render 30 bars.
    const tickCount = await rail.locator(':scope > span').count()
    expect(tickCount).toBeGreaterThan(2)
    expect(tickCount).toBeLessThanOrEqual(20)

    await orcaPage.screenshot({ path: path.join(SHOT_DIR, 'rail-01-app.png') })

    await rail.hover()
    const panel = orcaPage.locator('[data-slot="hover-card-content"]')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    // The panel lists every user message, not the sampled ticks.
    await expect(panel.getByRole('button').first()).toBeVisible()
    await orcaPage.screenshot({ path: path.join(SHOT_DIR, 'rail-02-panel.png') })

    // Exact, not `> ticks`: a panel that listed only the sampled ticks would
    // still satisfy a loose bound at 20 vs 20.
    const panelCount = await panel.getByRole('button').count()
    expect(panelCount).toBe(TRANSCRIPT_ROWS / 2)

    console.log(`[rail] ticks=${tickCount} panelRows=${panelCount} shots=${SHOT_DIR}`)
  })
})
