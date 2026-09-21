import type { Page } from '@stablyai/playwright-test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export async function withTerminalBrowserTrace<T>(
  page: Page,
  outputPath: string,
  measure: () => Promise<T>
): Promise<T> {
  const session = await page.context().newCDPSession(page)
  const events: unknown[] = []
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  try {
    await session.send('Tracing.start', {
      categories:
        '-*,devtools.timeline,disabled-by-default-devtools.timeline,blink,blink.user_timing,cc,toplevel,v8,renderer.scheduler,gpu,viz',
      transferMode: 'ReportEvents'
    })
    try {
      await page.evaluate(() => performance.mark('orca-perf-measure-start'))
      return await measure()
    } finally {
      await page.evaluate(() => performance.mark('orca-perf-measure-end')).catch(() => undefined)
      const completed = new Promise<void>((resolve) =>
        session.once('Tracing.tracingComplete', () => resolve())
      )
      await session.send('Tracing.end')
      await completed
      mkdirSync(path.dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, JSON.stringify({ traceEvents: events }))
    }
  } finally {
    await session.detach()
  }
}
