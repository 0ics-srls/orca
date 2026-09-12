// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeveloperPermissionRequestResult } from '../../../../shared/developer-permissions-types'
import type { VoiceSettings } from '../../../../shared/speech-types'

// Why: repo convention — React only suppresses its act() warning when this global is set.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, message: vi.fn() }
}))

import { VoiceMicrophoneSetting } from './VoiceMicrophoneSetting'

const voiceSettings = {
  enabled: true,
  microphoneDeviceId: null,
  microphoneDeviceLabel: null
} as VoiceSettings

function namedError(name: string, message = 'boom'): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function installMediaDevices(getUserMedia: () => Promise<MediaStream>): void {
  Object.assign(navigator, {
    mediaDevices: {
      getUserMedia: vi.fn(getUserMedia),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
  })
}

function installPermissionsApi(result: DeveloperPermissionRequestResult | Error): void {
  Object.assign(window, {
    api: {
      developerPermissions: {
        request: vi.fn(async () => {
          if (result instanceof Error) {
            throw result
          }
          return result
        })
      }
    }
  })
}

let container: HTMLDivElement
let root: Root

async function renderSetting(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <VoiceMicrophoneSetting voiceSettings={voiceSettings} onUpdateVoiceSettings={() => {}} />
    )
  })
}

async function clickAllowAccess(): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Allow access'
  )
  if (!button) {
    throw new Error('Allow access button not rendered')
  }
  await act(async () => {
    button.click()
  })
}

function alertText(): string {
  return container.querySelector('[role="alert"]')?.textContent ?? ''
}

describe('VoiceMicrophoneSetting access failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installPermissionsApi({ id: 'microphone', status: 'denied', openedSystemSettings: false })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('routes a denied getUserMedia to the OS permission request and says where to grant it', async () => {
    installMediaDevices(async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    })

    await renderSetting()
    await clickAllowAccess()

    expect(window.api.developerPermissions.request).toHaveBeenCalledWith({ id: 'microphone' })
    expect(alertText()).toBe(
      'Microphone access is blocked. Grant it in your system settings, then try again.'
    )
  })

  it('points at Privacy & Security once the request opened it', async () => {
    installMediaDevices(async () => {
      throw namedError('NotAllowedError')
    })
    installPermissionsApi({ id: 'microphone', status: 'denied', openedSystemSettings: true })

    await renderSetting()
    await clickAllowAccess()

    expect(alertText()).toBe(
      'Opened macOS Privacy & Security. Grant microphone access, then try again.'
    )
  })

  it('still reports a block on platforms where the OS request is unsupported', async () => {
    installMediaDevices(async () => {
      throw namedError('NotAllowedError')
    })
    installPermissionsApi({ id: 'microphone', status: 'unsupported', openedSystemSettings: false })

    await renderSetting()
    await clickAllowAccess()

    expect(alertText()).toBe(
      'Microphone access is blocked. Grant it in your system settings, then try again.'
    )
  })

  it('names the missing-hardware case instead of a permission instruction', async () => {
    installMediaDevices(async () => {
      throw namedError('NotFoundError')
    })

    await renderSetting()
    await clickAllowAccess()

    expect(window.api.developerPermissions.request).not.toHaveBeenCalled()
    expect(alertText()).toBe('No microphone was found. Connect one, then try again.')
  })

  it('keeps the underlying detail for an unclassified failure', async () => {
    installMediaDevices(async () => {
      throw namedError('AbortError', 'Could not start audio source')
    })

    await renderSetting()
    await clickAllowAccess()

    expect(alertText()).toBe('Could not open the microphone. Could not start audio source')
  })

  it('shows the plain hint until something actually fails', async () => {
    installMediaDevices(async () => ({ getTracks: () => [] }) as unknown as MediaStream)

    await renderSetting()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Allow microphone access to list input devices.')

    await clickAllowAccess()

    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('opens a stream after the OS grant so the device list is not left empty', async () => {
    let calls = 0
    let streamOpened = false
    const getUserMedia = vi.fn(async () => {
      calls += 1
      // Why: the first attempt is what triggers the OS prompt; the grant must re-open a stream,
      // because enumerateDevices hides labels until one has been opened in this renderer.
      if (calls === 1) {
        throw namedError('NotAllowedError')
      }
      streamOpened = true
      return { getTracks: () => [] } as unknown as MediaStream
    })
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia,
        // Why: mirrors the real rule the fix exists for — no labels until a stream has been opened.
        enumerateDevices: vi.fn(async () =>
          streamOpened
            ? [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone' }]
            : []
        ),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    })
    installPermissionsApi({ id: 'microphone', status: 'granted', openedSystemSettings: false })

    await renderSetting()
    await clickAllowAccess()

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    // Why: the grant is only useful if the list it unblocks actually fills in — the hint and its
    // Allow access button are what the pane shows while no device is known.
    expect(container.textContent).not.toContain('Allow microphone access to list input devices.')
  })

  it('keeps a second browser denial classified as a permission error', async () => {
    installMediaDevices(async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    })
    installPermissionsApi({ id: 'microphone', status: 'granted', openedSystemSettings: false })

    await renderSetting()
    await clickAllowAccess()

    expect(alertText()).toBe(
      'Microphone access is blocked. Grant it in your system settings, then try again.'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('names the missing-hardware case for the legacy DevicesNotFoundError alias', async () => {
    installMediaDevices(async () => {
      throw namedError('DevicesNotFoundError')
    })

    await renderSetting()
    await clickAllowAccess()

    expect(alertText()).toBe('No microphone was found. Connect one, then try again.')
  })

  it('treats SecurityError as a permission denial, like NotAllowedError', async () => {
    installMediaDevices(async () => {
      throw namedError('SecurityError')
    })

    await renderSetting()
    await clickAllowAccess()

    expect(window.api.developerPermissions.request).toHaveBeenCalledWith({ id: 'microphone' })
    expect(alertText()).toBe(
      'Microphone access is blocked. Grant it in your system settings, then try again.'
    )
  })

  it('reports a failed permission REQUEST as such, with the IPC wrapper stripped', async () => {
    installMediaDevices(async () => {
      throw namedError('NotAllowedError')
    })
    installPermissionsApi(
      new Error(
        "Error invoking remote method 'developerPermissions:request': Error: xdg-open not found"
      )
    )

    await renderSetting()
    await clickAllowAccess()

    // Why: the microphone was never reopened — calling this a microphone-open failure would invert
    // the provenance, and the raw transport prefix must never reach the pane.
    expect(alertText()).toBe('xdg-open not found')
    expect(alertText()).not.toContain('Error invoking remote method')
  })
})
