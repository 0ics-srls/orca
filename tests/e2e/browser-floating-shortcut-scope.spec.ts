import { createServer, type Server } from 'node:http'
import { expect, test } from './helpers/orca-app'
import type { Page } from '@stablyai/playwright-test'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID in src/shared/constants.ts.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
const FLOATING_PANEL = '[data-floating-terminal-panel][aria-hidden="false"]'
const isMac = process.platform === 'darwin'
const modifier = isMac ? 'Meta' : 'Control'
const backChord = isMac ? 'Meta+BracketLeft' : 'Alt+ArrowLeft'
const forwardChord = isMac ? 'Meta+BracketRight' : 'Alt+ArrowRight'

type Fixture = {
  splitGroupId: string
  splitRoot: string
  splitTabId: string
  floatingTabId: string
}

async function startFixtureServer(): Promise<{
  origin: string
  hits: Map<string, number>
  close: () => Promise<void>
}> {
  const hits = new Map<string, number>()
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1)
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${pathname}</title><body>${pathname}</body>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server has no port')
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    hits,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

async function openSplitAndFloatingBrowsers(
  page: Page,
  splitUrl: string,
  floatingUrl: string
): Promise<Fixture> {
  const ids = await page.evaluate(
    ({ floatingWorktreeId, splitUrl, floatingUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      store.setState({ settings: { ...store.getState().settings, floatingTerminalEnabled: true } })
      const state = store.getState()
      const worktreeId = state.activeWorktreeId
      if (!worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      const terminalGroupId = state.ensureWorktreeRootGroup(worktreeId)
      const splitGroupId = state.createEmptySplitGroup(worktreeId, terminalGroupId, 'right')
      if (!splitGroupId) {
        throw new Error('Browser split unavailable')
      }
      const splitTab = state.createBrowserTab(worktreeId, splitUrl, {
        activate: true,
        focusAddressBar: false,
        targetGroupId: splitGroupId
      })
      const floatingTab = state.createBrowserTab(floatingWorktreeId, floatingUrl, {
        activate: true,
        focusAddressBar: false,
        targetGroupId: state.ensureWorktreeRootGroup(floatingWorktreeId),
        browserRuntimeEnvironmentId: null
      })
      return { splitGroupId, splitTabId: splitTab.id, floatingTabId: floatingTab.id }
    },
    { floatingWorktreeId: FLOATING_WORKTREE_ID, splitUrl, floatingUrl }
  )
  // Why: the toggle listener closes over floatingTerminalEnabled, so wait for the panel to mount.
  await page.waitForFunction(() =>
    Boolean(document.querySelector('[data-floating-terminal-panel]'))
  )
  if ((await page.locator(FLOATING_PANEL).count()) === 0) {
    await page.evaluate(() => window.dispatchEvent(new Event('orca-toggle-floating-terminal')))
  }
  await expect(page.locator(FLOATING_PANEL)).toBeVisible()
  return { ...ids, splitRoot: `[data-browser-overlay-tab-id="${ids.splitTabId}"]` }
}

async function focusSplitGroup(page: Page, groupId: string): Promise<void> {
  await page.evaluate((targetGroupId) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    if (state && worktreeId) {
      state.focusGroup(worktreeId, targetGroupId)
    }
  }, groupId)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        return worktreeId ? state.activeGroupIdByWorktree[worktreeId] : null
      })
    )
    .toBe(groupId)
}

function addressBar(page: Page, root: string) {
  return page.locator(`${root} [data-orca-browser-address-bar="true"]`)
}

function findInput(page: Page, root: string) {
  return page.locator(root).getByPlaceholder('Find in page...')
}

function grabButton(page: Page, root: string) {
  return page.locator(root).getByRole('button', { name: 'Grab page element', exact: true })
}

async function navigateFromAddressBar(page: Page, root: string, url: string): Promise<void> {
  const bar = addressBar(page, root)
  await bar.fill(url)
  await bar.press('Enter')
  await expect(bar).toHaveValue(url)
}

// Why: a non-editable chrome target, so reload and grab are not skipped as text-field keys.
async function focusChrome(page: Page, root: string): Promise<void> {
  const target = grabButton(page, root)
  await expect(target).toBeEnabled()
  await target.focus()
  await expect(target).toBeFocused()
}

async function expectUrls(page: Page, roots: { root: string; url: string }[]): Promise<void> {
  for (const { root, url } of roots) {
    await expect(addressBar(page, root)).toHaveValue(url)
  }
}

async function pressBackInFloatingGuest(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async (panel) => {
        const webview = document.querySelector<Electron.WebviewTag>(`${panel} webview`)
        try {
          return webview ? webview.getWebContentsId() > 0 : false
        } catch {
          return false
        }
      }, FLOATING_PANEL)
    )
    .toBe(true)
  await page.evaluate(
    async ({ panel, keyCode, inputModifier }) => {
      const webview = document.querySelector<Electron.WebviewTag>(`${panel} webview`)
      if (!webview) {
        throw new Error('Floating browser guest unavailable')
      }
      webview.focus()
      await webview.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [inputModifier] })
      await webview.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [inputModifier] })
    },
    {
      panel: FLOATING_PANEL,
      keyCode: isMac ? '[' : 'Left',
      inputModifier: isMac ? ('meta' as const) : ('alt' as const)
    }
  )
}

test.describe('floating browser shortcut scope', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('chrome shortcuts act only in the pane that owns the key press', async ({ orcaPage }) => {
    const server = await startFixtureServer()
    const url = (path: string): string => `${server.origin}${path}`
    try {
      const fixture = await openSplitAndFloatingBrowsers(orcaPage, url('/split-1'), url('/float-1'))
      const split = fixture.splitRoot
      const floating = FLOATING_PANEL
      await focusSplitGroup(orcaPage, fixture.splitGroupId)
      await navigateFromAddressBar(orcaPage, split, url('/split-2'))
      await navigateFromAddressBar(orcaPage, floating, url('/float-2'))

      const cases = [
        { owner: floating, other: split, ownerPath: '/float', otherPath: '/split' },
        { owner: split, other: floating, ownerPath: '/split', otherPath: '/float' }
      ]
      for (const { owner, other, ownerPath, otherPath } of cases) {
        await test.step(`keys pressed in ${ownerPath} chrome`, async () => {
          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(backChord)
          await expectUrls(orcaPage, [
            { root: owner, url: url(`${ownerPath}-1`) },
            { root: other, url: url(`${otherPath}-2`) }
          ])
          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(forwardChord)
          await expectUrls(orcaPage, [
            { root: owner, url: url(`${ownerPath}-2`) },
            { root: other, url: url(`${otherPath}-2`) }
          ])

          const ownerHits = server.hits.get(`${ownerPath}-2`) ?? 0
          const otherHits = server.hits.get(`${otherPath}-2`) ?? 0
          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(`${modifier}+r`)
          await expect.poll(() => server.hits.get(`${ownerPath}-2`) ?? 0).toBeGreaterThan(ownerHits)
          // Why: both panes would reload on the same keydown, so the owner's request bounds the wait.
          await orcaPage.waitForTimeout(500)
          expect(server.hits.get(`${otherPath}-2`) ?? 0).toBe(otherHits)

          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(`${modifier}+f`)
          await expect(findInput(orcaPage, owner)).toBeFocused()
          await expect(findInput(orcaPage, other)).toBeHidden()
          await orcaPage.keyboard.press('Escape')
          await expect(findInput(orcaPage, owner)).toBeHidden()

          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(`${modifier}+l`)
          await expect(addressBar(orcaPage, owner)).toBeFocused()

          await focusChrome(orcaPage, owner)
          await orcaPage.keyboard.press(`${modifier}+c`)
          await expect(grabButton(orcaPage, owner)).toHaveAttribute('data-variant', 'default')
          await expect(grabButton(orcaPage, other)).toHaveAttribute('data-variant', 'ghost')
          await grabButton(orcaPage, owner).click()
          await expect(grabButton(orcaPage, owner)).toHaveAttribute('data-variant', 'ghost')
        })
      }

      await test.step('back pressed inside the floating page', async () => {
        await pressBackInFloatingGuest(orcaPage)
        await expectUrls(orcaPage, [
          { root: floating, url: url('/float-1') },
          { root: split, url: url('/split-2') }
        ])
      })
    } finally {
      await server.close()
    }
  })
})
