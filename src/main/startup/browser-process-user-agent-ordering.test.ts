import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('browser process user-agent startup ordering', () => {
  it('initializes after the pre-ready app name and before ready/session/window work', () => {
    const preflight = readFileSync(join(__dirname, 'main-process-preflight.ts'), 'utf8')
    const entry = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    const readyFoundation = readFileSync(
      join(__dirname, 'main-process-ready-foundation.ts'),
      'utf8'
    )

    const preReadyName = preflight.indexOf(
      'app.setName(state.devInstanceIdentity.appName)',
      preflight.indexOf('shouldApplyPreReadyAppName')
    )
    const initialize = preflight.indexOf('initializeBrowserProcessUserAgent()')
    const previewScheme = preflight.indexOf('registerDocPreviewSchemePrivileges()')
    const preflightCall = entry.indexOf('runMainProcessPreflight({')
    const ready = entry.indexOf('app.whenReady()')

    expect(preReadyName).toBeGreaterThanOrEqual(0)
    expect(initialize).toBeGreaterThan(preReadyName)
    expect(initialize).toBeLessThan(previewScheme)
    expect(preflightCall).toBeGreaterThanOrEqual(0)
    expect(preflightCall).toBeLessThan(ready)
    expect(readyFoundation.indexOf('session.defaultSession')).toBeGreaterThanOrEqual(0)
    expect(readyFoundation.indexOf('new BrowserWindow')).toBe(-1)
  })
})
