import { withTerminalBrowserTrace } from './terminal-perf-browser-trace'
import type { Page } from '@stablyai/playwright-test'
import path from 'node:path'
import { test } from './helpers/orca-app'
import { withTypingRendererCpuProfile } from './typing-renderer-cpu-profile'

export function configureTerminalPerfDiagnostics(): void {
  test.beforeEach(async ({ electronApp, orcaPage }, testInfo) => {
    if (!process.env.ORCA_PERF_DIAGNOSTIC_DIR) {
      return
    }
    const visibility = await orcaPage.evaluate(() => document.visibilityState)
    const unthrottle = process.env.ORCA_PERF_DIAGNOSTIC_UNTHROTTLE === '1'
    const visibleOnXvfb = process.env.ORCA_PERF_DIAGNOSTIC_XVFB_VISIBLE === '1'
    if (visibleOnXvfb) {
      if (process.platform !== 'linux' || !process.env.GITHUB_ACTIONS || !process.env.DISPLAY) {
        throw new Error('Visible diagnostic requires an isolated GitHub Actions Xvfb display')
      }
      await electronApp.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.showInactive()
        }
      })
    }
    const windows = await electronApp.evaluate(({ BrowserWindow }, unthrottle) => {
      return BrowserWindow.getAllWindows().map((window) => {
        if (unthrottle) {
          window.webContents.setBackgroundThrottling(false)
        }
        return {
          visible: window.isVisible(),
          throttled: window.webContents.getBackgroundThrottling()
        }
      })
    }, unthrottle)
    testInfo.annotations.push({
      type: 'perf-diagnostic-window',
      description: JSON.stringify({
        windows,
        visibility,
        renderer: process.env.ORCA_PERF_DIAGNOSTIC_RENDERER ?? 'current'
      })
    })
  })
}

export async function withTerminalPerfProfile<T>(
  page: Page,
  phase: string,
  runId: string,
  measure: () => Promise<T>
): Promise<T> {
  const directory = process.env.ORCA_PERF_DIAGNOSTIC_DIR
  if (!directory) {
    return measure()
  }
  const watcher = await page.evaluateHandle(() => {
    const longTasks: { start: number; duration: number }[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration })
      }
    })
    observer.observe({ type: 'longtask' })
    const started = performance.now()
    return {
      stop: () => {
        observer.disconnect()
        return {
          started,
          finished: performance.now(),
          visibility: document.visibilityState,
          longTasks
        }
      }
    }
  })
  try {
    const result =
      process.env.ORCA_PERF_DIAGNOSTIC_TRACE === '1'
        ? await withTerminalBrowserTrace(
            page,
            path.join(directory, `${phase}-${runId}.trace.json`),
            measure
          )
        : await withTypingRendererCpuProfile(
            page,
            path.join(directory, `${phase}-${runId}.cpuprofile`),
            measure
          )
    console.error(
      JSON.stringify({
        phase,
        runId,
        result,
        renderer: await watcher.evaluate((watcher) => watcher.stop())
      })
    )
    return result
  } finally {
    await watcher.evaluate((watcher) => watcher.stop()).catch(() => undefined)
    await watcher.dispose()
  }
}
