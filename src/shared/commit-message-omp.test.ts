import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import { getCommitMessageAgentSpec } from './commit-message-agent-spec'
import { resolveSourceControlAiForOperation } from './source-control-ai'

describe('OMP Source Control AI', () => {
  it.each(['commitMessage', 'pullRequest', 'branchName'] as const)(
    'uses the configured OMP default for %s without requiring a model override',
    (operation) => {
      const settings = getDefaultSettings('/tmp')
      settings.defaultTuiAgent = 'omp'
      const result = resolveSourceControlAiForOperation({ settings, repo: null, operation })
      expect(result).toMatchObject({
        ok: true,
        value: { params: { agentId: 'omp', model: 'default' } }
      })
    }
  )
  it('delivers large diffs on stdin and keeps generation isolated from tools and extensions', () => {
    const spec = getCommitMessageAgentSpec('omp')
    expect(spec?.promptDelivery).toBe('stdin')
    if (!spec) {
      throw new Error('Missing OMP spec')
    }
    const args = spec.buildArgs({ prompt: 'large diff', model: 'default' })
    expect(args).toEqual([
      '--print',
      '--no-session',
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-rules',
      '--mode',
      'text'
    ])
    expect(
      spec?.buildArgs({ prompt: '', model: 'provider/exact-model', thinkingLevel: 'low' })
    ).toEqual([...args, '--model', 'provider/exact-model', '--thinking', 'low'])
  })
  it('discovers provider-qualified models through the existing OMP JSON parser', () => {
    const discovery = getCommitMessageAgentSpec('omp')?.modelDiscovery
    expect(discovery?.args).toEqual(['models', '--json'])
    expect(
      discovery?.parse(
        JSON.stringify({
          models: [{ provider: 'provider', id: 'm', selector: 'provider/m', name: 'Model' }]
        })
      )
    ).toEqual([{ id: 'provider/m', label: 'Model', description: 'provider' }])
  })
})
