// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { NativeChatExperimentalSetting } from './NativeChatExperimentalSetting'

afterEach(() => cleanup())

const SHELL_ENV_TOGGLE = '[aria-label="Toggle using your shell environment"]'
const NAMES_INPUT = '#settings-native-chat-shell-environment-names'

function renderSetting(overrides: Partial<GlobalSettings>, updateSettings = vi.fn()) {
  return render(
    <NativeChatExperimentalSetting
      settings={{ ...getDefaultSettings('/tmp'), ...overrides }}
      updateSettings={updateSettings}
    />
  )
}

describe('NativeChatExperimentalSetting shell environment', () => {
  it('shows only when Chat UI, the Chat UI default view, and structured chat are all on', () => {
    for (const experimentalNativeChat of [false, true]) {
      for (const openAgentTabsInChatByDefault of [false, true]) {
        for (const experimentalStructuredNativeChat of [false, true]) {
          const { container, unmount } = renderSetting({
            experimentalNativeChat,
            openAgentTabsInChatByDefault,
            experimentalStructuredNativeChat
          })
          const expected =
            experimentalNativeChat &&
            openAgentTabsInChatByDefault &&
            experimentalStructuredNativeChat
          expect(
            container.querySelector(SHELL_ENV_TOGGLE) !== null,
            JSON.stringify({
              experimentalNativeChat,
              openAgentTabsInChatByDefault,
              experimentalStructuredNativeChat
            })
          ).toBe(expected)
          unmount()
        }
      }
    }
  })

  const structuredOn = {
    experimentalNativeChat: true,
    openAgentTabsInChatByDefault: true,
    experimentalStructuredNativeChat: true
  }

  it('hides the variable list while the whole shell is inherited', () => {
    const { container } = renderSetting(structuredOn)
    expect(container.querySelector(NAMES_INPUT)).toBeNull()
  })

  it('turns inheritance off from the toggle', () => {
    const updateSettings = vi.fn()
    const { container } = renderSetting(structuredOn, updateSettings)
    fireEvent.click(container.querySelector(SHELL_ENV_TOGGLE)!)
    expect(updateSettings).toHaveBeenCalledWith({ nativeChatInheritShellEnvironment: false })
  })

  it('commits parsed names when focus leaves the list', () => {
    const updateSettings = vi.fn()
    const { container } = renderSetting(
      { ...structuredOn, nativeChatInheritShellEnvironment: false },
      updateSettings
    )
    const input = container.querySelector<HTMLTextAreaElement>(NAMES_INPUT)!

    fireEvent.change(input, { target: { value: 'CODEX_LB_API_KEY,\nFOO-BAR; HTTPS_PROXY' } })
    fireEvent.blur(input)

    expect(updateSettings).toHaveBeenCalledWith({
      nativeChatShellEnvironmentVariables: ['CODEX_LB_API_KEY', 'HTTPS_PROXY']
    })
  })
})
