// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { MacosTccPromptNoticeHost } from './MacosTccPromptNoticeHost'

type FolderAccessMismatch = { daemonScope: string; cwdClass: string } | null
type AttributionResult = {
  health: 'intact' | 'severed' | 'unknown'
  folderAccessMismatch: FolderAccessMismatch
}

const macTccAttribution = vi.hoisted(() =>
  vi.fn(async (): Promise<AttributionResult> => ({ health: 'intact', folderAccessMismatch: null }))
)
const trackTelemetry = vi.hoisted(() => vi.fn())
const openSettingsPage = vi.hoisted(() => vi.fn())
const openSettingsTarget = vi.hoisted(() => vi.fn())
const setSettingsSearchQuery = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ value: 'darwin' as NodeJS.Platform }))

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    dismiss: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
      hasResourceBundle: () => true
    }
  })
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      openSettingsPage,
      openSettingsTarget,
      setSettingsSearchQuery,
      settings: { uiLanguage: 'en' }
    })
}))

vi.mock('@/store/plugin-language-packs', () => ({
  usePluginLanguagePackStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ packs: [], loaded: true })
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) => options?.[name] ?? match)
}))

vi.mock('@/lib/telemetry', () => ({ track: trackTelemetry }))

vi.mock('./useMacosTccPromptNotice', () => ({
  useMacosTccPromptNotice: vi.fn()
}))

describe('useMacTccAttributionSeveredNotice', () => {
  beforeEach(() => {
    macTccAttribution.mockReset()
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: null })
    trackTelemetry.mockReset()
    openSettingsPage.mockReset()
    openSettingsTarget.mockReset()
    setSettingsSearchQuery.mockReset()
    platform.value = 'darwin'
    vi.mocked(toast.warning).mockReset()
    vi.mocked(toast.dismiss).mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        platform: {
          get: () => ({ platform: platform.value })
        },
        pty: {
          management: {
            macTccAttribution
          }
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('does not toast when attribution is intact', async () => {
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalled()
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('does not probe on non-macOS focus', async () => {
    platform.value = 'win32'
    render(<MacosTccPromptNoticeHost />)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(macTccAttribution).not.toHaveBeenCalled()
  })

  it('toasts Manage Sessions remedy once when attribution is severed', async () => {
    macTccAttribution.mockResolvedValue({ health: 'severed', folderAccessMismatch: null })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    const call = vi.mocked(toast.warning).mock.calls[0]
    const title = String(call?.[0] ?? '')
    const options = call?.[1] as
      | { description?: string; action?: { onClick?: () => void } }
      | undefined
    expect(title).toMatch(/macOS permissions may not reach Orca terminals/i)
    expect(String(options?.description ?? '')).toMatch(/Manage Sessions/i)
    options?.action?.onClick?.()
    expect(setSettingsSearchQuery).toHaveBeenCalledWith('')
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'terminal',
      repoId: null,
      sectionId: 'terminal-manage-sessions'
    })
    expect(openSettingsPage).toHaveBeenCalled()
  })

  it('does not toast again after the first severed notice this session', async () => {
    macTccAttribution.mockResolvedValue({ health: 'severed', folderAccessMismatch: null })
    const { rerender } = render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    rerender(<MacosTccPromptNoticeHost />)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(2)
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
  })

  it('dismisses the warning after attribution recovers', async () => {
    macTccAttribution.mockResolvedValueOnce({ health: 'severed', folderAccessMismatch: null })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: null })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(2)
      expect(toast.dismiss).toHaveBeenCalledWith('mac-tcc-attribution-severed')
    })
  })

  it('coalesces overlapping mount/focus checks into one IPC call and one toast', async () => {
    let resolveHealth!: (value: AttributionResult) => void
    const pending = new Promise<AttributionResult>((resolve) => {
      resolveHealth = resolve
    })
    macTccAttribution.mockImplementation(() => pending)

    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(1)
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(macTccAttribution).toHaveBeenCalledTimes(1)
    expect(toast.warning).not.toHaveBeenCalled()

    await act(async () => {
      resolveHealth({ health: 'severed', folderAccessMismatch: null })
      await pending
    })
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(1)
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
  })

  it('clears the in-flight guard on rejection so a later focus can retry', async () => {
    macTccAttribution
      .mockRejectedValueOnce(new Error('probe failed'))
      .mockResolvedValueOnce({ health: 'severed', folderAccessMismatch: null })

    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(1)
    })
    expect(toast.warning).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(2)
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })
  })
})

describe('useMacTccAttributionSeveredNotice folder-access notice', () => {
  const SCOPE_A = { daemonScope: 'aaaa111122223333', cwdClass: 'documents' }
  const SCOPE_B = { daemonScope: 'bbbb444455556666', cwdClass: 'desktop' }

  type ToastOptions = {
    id?: string
    description?: string
    action?: { onClick?: () => void }
    cancel?: { onClick?: () => void }
  }

  function folderNoticeCalls(): { title: string; options: ToastOptions }[] {
    return vi
      .mocked(toast.warning)
      .mock.calls.map((call) => ({
        title: String(call[0] ?? ''),
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook is the only caller and always passes this options object.
        options: (call[1] ?? {}) as ToastOptions
      }))
      .filter(({ options }) => options.id === 'mac-daemon-folder-access-mismatch')
  }

  beforeEach(() => {
    macTccAttribution.mockReset()
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: null })
    trackTelemetry.mockReset()
    openSettingsPage.mockReset()
    openSettingsTarget.mockReset()
    setSettingsSearchQuery.mockReset()
    platform.value = 'darwin'
    vi.mocked(toast.warning).mockReset()
    vi.mocked(toast.dismiss).mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        platform: { get: () => ({ platform: platform.value }) },
        pty: { management: { macTccAttribution } }
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('does not toast when there is no mismatch', async () => {
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalled()
    })
    expect(folderNoticeCalls()).toHaveLength(0)
  })

  it('names the denied folder and offers the Manage Sessions remedy', async () => {
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(1)
    })

    const notice = folderNoticeCalls()[0]
    expect(notice.title).toMatch(/can’t read your Documents folder/i)
    expect(String(notice.options.description)).toMatch(/Operation not permitted/i)
    expect(String(notice.options.description)).toMatch(/Privacy & Security/i)

    notice.options.action?.onClick?.()
    expect(setSettingsSearchQuery).toHaveBeenCalledWith('')
    expect(openSettingsTarget).toHaveBeenCalledWith({
      pane: 'terminal',
      repoId: null,
      sectionId: 'terminal-manage-sessions'
    })
    expect(openSettingsPage).toHaveBeenCalled()
    expect(trackTelemetry).toHaveBeenCalledWith('daemon_folder_access_notice', {
      action: 'open_manage_sessions',
      cwd_class: 'documents'
    })
  })

  it('substitutes the folder word for each protected class', async () => {
    for (const [cwdClass, expected] of [
      ['desktop', 'Desktop folder'],
      ['downloads', 'Downloads folder'],
      ['other-home', 'a workspace folder'],
      ['outside-home', 'a workspace folder']
    ]) {
      vi.mocked(toast.warning).mockReset()
      macTccAttribution.mockResolvedValue({
        health: 'intact',
        folderAccessMismatch: { daemonScope: `scope-${cwdClass}`, cwdClass }
      })
      render(<MacosTccPromptNoticeHost />)
      await waitFor(() => {
        expect(folderNoticeCalls()).toHaveLength(1)
      })
      expect(folderNoticeCalls()[0].title).toContain(expected)
      cleanup()
    }
  })

  it('shows once per daemon scope, not once per poll', async () => {
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(1)
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(2)
    })
    expect(folderNoticeCalls()).toHaveLength(1)
  })

  it('never re-shows a scope the user dismissed this session', async () => {
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(1)
    })

    folderNoticeCalls()[0].options.cancel?.onClick?.()
    expect(trackTelemetry).toHaveBeenCalledWith('daemon_folder_access_notice', {
      action: 'dismissed',
      cwd_class: 'documents'
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(macTccAttribution).toHaveBeenCalledTimes(2)
    })
    expect(folderNoticeCalls()).toHaveLength(1)
  })

  // The restart remedy: a replacement daemon mints a new identity, so the poll goes quiet.
  it('dismisses the notice once the poll stops reporting a mismatch', async () => {
    macTccAttribution.mockResolvedValueOnce({ health: 'intact', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(1)
    })
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: null })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(toast.dismiss).toHaveBeenCalledWith('mac-daemon-folder-access-mismatch')
    })
  })

  it('shows again when a replacement daemon is denied too', async () => {
    macTccAttribution.mockResolvedValueOnce({ health: 'intact', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(1)
    })
    macTccAttribution.mockResolvedValue({ health: 'intact', folderAccessMismatch: SCOPE_B })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => {
      expect(folderNoticeCalls()).toHaveLength(2)
    })
    expect(folderNoticeCalls()[1].title).toContain('Desktop folder')
  })

  it('raises both notices when attribution is severed and a folder is denied', async () => {
    macTccAttribution.mockResolvedValue({ health: 'severed', folderAccessMismatch: SCOPE_A })
    render(<MacosTccPromptNoticeHost />)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledTimes(2)
    })
    expect(folderNoticeCalls()).toHaveLength(1)
  })
})
