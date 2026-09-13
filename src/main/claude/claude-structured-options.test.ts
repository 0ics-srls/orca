import { describe, expect, it, vi } from 'vitest'
import {
  restoreClaudeStructuredSessionOptions,
  setClaudeStructuredOption
} from './claude-structured-options'
import type { ClaudeSession } from './claude-structured-session-state'
import { ClaudeBackgroundTaskTracker } from './claude-background-task-tracker'
import { ClaudeSlashCommandCatalog } from './claude-slash-command-catalog'
import {
  observeClaudeFastModeFacts,
  readClaudeStructuredSessionOptions
} from './claude-structured-session-options'

function sessionFor(setModel: ClaudeSession['connection']['setModel']): ClaudeSession {
  return {
    // An empty catalog identifies no model, so the pre-flight refuses nothing and
    // this stays a test about fencing.
    connection: {
      setModel,
      supportedModels: async (): Promise<unknown[]> => []
    } as ClaudeSession['connection'],
    providerSessionId: 'provider-session',
    claudeConfigDir: '/accounts/claude',
    leafUuid: null,
    fence: 1,
    acquisitionGeneration: 'generation-1',
    prompts: {} as ClaudeSession['prompts'],
    dispatchWaiters: [],
    retiredDispatchWaiters: [],
    replayContentFallbackBlocked: false,
    backgroundTasks: new ClaudeBackgroundTaskTracker(),
    commands: new ClaudeSlashCommandCatalog(),
    dispatchSequence: 0,
    optionMutationSequence: 0,
    options: new Map(),
    reportedOptions: {},
    reportedModelMutation: 0,
    confirmedOptions: new Set(),
    restoreSkippedOptions: new Set(),
    capabilities: [],
    events: undefined,
    translator: null
  }
}

describe('Claude structured option mutation fencing', () => {
  it('does not let a delayed earlier apply overwrite a later option', async () => {
    let releaseFirst!: () => void
    const firstApply = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const setModel = vi
      .fn<ClaudeSession['connection']['setModel']>()
      .mockReturnValueOnce(firstApply)
      .mockResolvedValue(undefined)
    const session = sessionFor(setModel)

    const first = setClaudeStructuredOption(session, { key: 'model', value: 'old' }, undefined)
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledTimes(1))
    const second = setClaudeStructuredOption(session, { key: 'model', value: 'new' }, undefined)
    await expect(second).resolves.toEqual({ model: 'new' })

    releaseFirst()
    await expect(first).resolves.toEqual({ model: 'new' })
    expect(session.options).toEqual(new Map([['model', 'new']]))
  })
})

function fastModeSession(supportsFastMode: boolean | undefined) {
  let reportedFastMode = false
  const applyFlagSettings = vi.fn(async (settings: { fastMode?: boolean }) => {
    if (typeof settings.fastMode === 'boolean') {
      reportedFastMode = settings.fastMode
    }
  })
  const session = sessionFor(vi.fn(async () => undefined))
  session.options.set('model', 'opus')
  session.connection = {
    ...session.connection,
    supportedModels: async () => [
      {
        value: 'opus',
        resolvedModel: 'claude-opus-current',
        displayName: 'Opus',
        ...(supportsFastMode === undefined ? {} : { supportsFastMode })
      }
    ],
    applyFlagSettings,
    getSettings: async () => ({ effective: { fastMode: reportedFastMode } })
  } as ClaudeSession['connection']
  return { session, applyFlagSettings }
}

describe('Claude structured Fast mode', () => {
  it('applies absolute on and off values and confirms provider readback', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)

    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).resolves.toMatchObject({ fastMode: 'true' })
    expect(session.confirmedOptions.has('fastMode')).toBe(true)
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'false' }, undefined)
    ).resolves.toMatchObject({ fastMode: 'false' })
    expect(applyFlagSettings).toHaveBeenNthCalledWith(
      1,
      { fastMode: true },
      { timeoutMs: undefined }
    )
    expect(applyFlagSettings).toHaveBeenNthCalledWith(
      2,
      { fastMode: false },
      { timeoutMs: undefined }
    )
  })

  it('rejects definitively unsupported Fast before applying', async () => {
    const { session, applyFlagSettings } = fastModeSession(false)
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).rejects.toThrow('does not support Fast mode')
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })

  it('does not authorize a new Fast enable when model support is unknown', async () => {
    const { session, applyFlagSettings } = fastModeSession(undefined)

    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).rejects.toThrow('does not support Fast mode')
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })

  it.each([undefined, false])(
    'allows explicit Fast off when model support is %s',
    async (supportsFastMode) => {
      const { session, applyFlagSettings } = fastModeSession(supportsFastMode)

      await expect(
        setClaudeStructuredOption(session, { key: 'fastMode', value: 'false' }, undefined)
      ).resolves.toMatchObject({ fastMode: 'false' })
      expect(applyFlagSettings).toHaveBeenCalledWith({ fastMode: false }, { timeoutMs: undefined })
    }
  )

  it('restores explicit Fast off when model support is unknown', async () => {
    const { session, applyFlagSettings } = fastModeSession(undefined)
    session.options.set('fastMode', 'false')

    await restoreClaudeStructuredSessionOptions(session, undefined)

    expect(session.options.get('fastMode')).toBe('false')
    expect(session.restoreSkippedOptions.has('fastMode')).toBe(false)
    expect(applyFlagSettings).toHaveBeenCalledWith({ fastMode: false }, { timeoutMs: undefined })
  })

  it('resolves the running CLI default model before applying Fast', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.options.delete('model')
    session.connection.supportedModels = async () => [
      { value: 'default', resolvedModel: 'claude-opus-current', displayName: 'Default' },
      {
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-current',
        displayName: 'Opus (1M context)',
        supportsFastMode: true
      }
    ]

    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).resolves.toMatchObject({ fastMode: 'true' })
    expect(applyFlagSettings).toHaveBeenCalledWith({ fastMode: true }, { timeoutMs: undefined })
  })

  it('rejects Fast on when the running session reports a blocking reason', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.fastModeDisabledReason = 'extra_usage_disabled'

    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).rejects.toThrow('extra_usage_disabled')
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })

  it('reconciles an earlier Fast request to a later provider readback', async () => {
    const { session } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.connection.getSettings = async () => ({ effective: { fastMode: false } })

    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      current: { fastMode: false, confirmed: ['fastMode'] }
    })
    expect(session.options.get('fastMode')).toBe('false')
    expect(session.confirmedOptions.has('fastMode')).toBe(true)
  })

  it('keeps the Fast preference on during cooldown when settings report it on', async () => {
    const { session } = fastModeSession(true)
    session.options.set('fastMode', 'false')
    session.connection.getSettings = async () => ({ effective: { fastMode: true } })
    observeClaudeFastModeFacts(session, { fast_mode_state: 'cooldown' })

    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      current: { fastMode: true, fastModeState: 'cooldown', confirmed: ['fastMode'] }
    })
    expect(session.options.get('fastMode')).toBe('true')
    expect(session.confirmedOptions.has('fastMode')).toBe(true)
  })

  it('publishes support and explicit false from running CLI reports', async () => {
    const { session } = fastModeSession(true)
    observeClaudeFastModeFacts(session, {
      fast_mode_state: 'cooldown',
      fast_mode_disabled_reason: null
    })
    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      models: [expect.objectContaining({ id: 'opus', supportsFastMode: true })],
      fastModeSupport: { supported: true },
      current: {
        model: 'opus',
        fastMode: false,
        fastModeState: 'cooldown',
        confirmed: ['fastMode']
      }
    })
  })

  it('hides Fast when the running CLI reports a blocking session reason', async () => {
    const { session } = fastModeSession(true)
    observeClaudeFastModeFacts(session, {
      fast_mode_state: 'off',
      fast_mode_disabled_reason: 'not_first_party'
    })

    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      fastModeSupport: { supported: false, reason: 'not_first_party' },
      current: { fastMode: false, fastModeState: 'off' }
    })
  })

  it('reconciles Fast off when switching to a model without support', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.connection.supportedModels = async () => [
      { value: 'opus', displayName: 'Opus', supportsFastMode: true },
      { value: 'haiku', displayName: 'Haiku', supportsFastMode: false }
    ]

    await expect(
      setClaudeStructuredOption(session, { key: 'model', value: 'haiku' }, undefined)
    ).resolves.toMatchObject({ model: 'haiku', fastMode: 'false' })
    expect(applyFlagSettings).toHaveBeenCalledWith({ fastMode: false }, { timeoutMs: undefined })
  })

  it('keeps Fast on across a model switch while support discovery is transient', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.connection.supportedModels = async () => {
      throw new Error('catalog temporarily unavailable')
    }

    await expect(
      setClaudeStructuredOption(session, { key: 'model', value: 'haiku' }, undefined)
    ).resolves.toMatchObject({ model: 'haiku', fastMode: 'true' })
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })

  it('reconciles a transient model switch once support is definitively unavailable', async () => {
    const { session } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.connection.supportedModels = async () => {
      throw new Error('catalog temporarily unavailable')
    }
    await setClaudeStructuredOption(session, { key: 'model', value: 'haiku' }, undefined)
    session.connection.supportedModels = async () => [
      { value: 'opus', displayName: 'Opus', supportsFastMode: true },
      { value: 'haiku', displayName: 'Haiku', supportsFastMode: false }
    ]

    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      current: { model: 'haiku', fastMode: false }
    })
    expect(session.options.get('fastMode')).toBe('false')
    expect(session.confirmedOptions.has('fastMode')).toBe(true)
  })

  it('keeps the accepted model when the unsupported-model Fast-off write fails', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.reportedOptions.fastMode = true
    session.confirmedOptions.add('fastMode')
    session.connection.supportedModels = async () => [
      { value: 'opus', displayName: 'Opus', supportsFastMode: true },
      { value: 'haiku', displayName: 'Haiku', supportsFastMode: false }
    ]
    applyFlagSettings.mockRejectedValueOnce(new Error('flag write failed'))

    await expect(
      setClaudeStructuredOption(session, { key: 'model', value: 'haiku' }, undefined)
    ).resolves.toMatchObject({ model: 'haiku', fastMode: 'false' })
    expect(session.reportedOptions.fastMode).toBe(true)
    expect(session.confirmedOptions.has('fastMode')).toBe(false)
  })

  it('treats an unrecognized provider disabled reason as unavailable', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    observeClaudeFastModeFacts(session, {
      fast_mode_state: 'off',
      fast_mode_disabled_reason: 'future_entitlement_rule'
    })

    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      fastModeSupport: { supported: false, reason: 'future_entitlement_rule' }
    })
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).rejects.toThrow('future_entitlement_rule')
    expect(applyFlagSettings).not.toHaveBeenCalled()
  })
})
