import { describe, expect, it } from 'vitest'
import { countFailedToolCalls, nativeChatToolRunSucceeded } from './native-chat-tool-run-outcome'
import type { NativeChatBlock } from './native-chat-types'

function call(command: string, state?: 'running' | 'completed' | 'failed'): NativeChatBlock {
  return { type: 'tool-call', name: 'shell', input: { command }, state }
}

function result(output: string, isError?: boolean): NativeChatBlock {
  return { type: 'tool-result', output, isError }
}

describe('countFailedToolCalls', () => {
  it('counts a provider failure verdict', () => {
    expect(countFailedToolCalls([call('a', 'failed'), result('exit 1', true)])).toBe(1)
  })

  it('counts an error result on a lane that writes no lifecycle state', () => {
    expect(countFailedToolCalls([call('a'), result('exit 1', true)])).toBe(1)
  })

  it('counts every failure, not just the run’s last call', () => {
    expect(
      countFailedToolCalls([
        call('a', 'failed'),
        result('exit 1', true),
        call('b', 'failed'),
        result('exit 2', true),
        call('c', 'completed'),
        result('ok')
      ])
    ).toBe(2)
  })

  it('counts a failed call once, not twice for its error result', () => {
    expect(countFailedToolCalls([call('a', 'failed'), result('exit 1', true)])).toBe(1)
  })

  it('reports nothing for a clean run', () => {
    expect(countFailedToolCalls([call('a', 'completed'), result('ok')])).toBe(0)
  })
})

describe('nativeChatToolRunSucceeded', () => {
  it('refuses success to a failed run even though nothing is running', () => {
    expect(nativeChatToolRunSucceeded([call('a', 'failed'), result('exit 1', true)], {})).toBe(
      false
    )
  })

  it('refuses success to a run whose call is still running', () => {
    expect(nativeChatToolRunSucceeded([call('a', 'running')], { activeTurnIsWorking: true })).toBe(
      false
    )
  })

  it('refuses success to a call still running after its turn ended', () => {
    expect(nativeChatToolRunSucceeded([call('a', 'running')], { activeTurnIsWorking: false })).toBe(
      false
    )
  })

  it('refuses success while a state-less call rides a working turn', () => {
    expect(nativeChatToolRunSucceeded([call('a')], { activeTurnIsWorking: true })).toBe(false)
  })

  it('grants success to a completed run', () => {
    expect(nativeChatToolRunSucceeded([call('a', 'completed'), result('ok')], {})).toBe(true)
  })

  it('still settles a legacy run that carries no lifecycle state', () => {
    expect(nativeChatToolRunSucceeded([call('a'), result('ok')], {})).toBe(true)
  })

  it('refuses success when one call of several failed', () => {
    expect(
      nativeChatToolRunSucceeded(
        [call('a', 'completed'), result('ok'), call('b', 'failed'), result('exit 1', true)],
        {}
      )
    ).toBe(false)
  })
})
