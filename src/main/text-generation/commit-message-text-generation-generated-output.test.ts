import { spawn } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext,
  trimGeneratedCommitMessage
} from './commit-message-text-generation'
import {
  buildPullRequestFieldsPrompt,
  type PullRequestDraftContext
} from '../../shared/pull-request-generation'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn)
  }
})

const spawnMock = vi.mocked(spawn)

const ECHOED_PR_CONTEXT: PullRequestDraftContext = {
  branch: 'feature/pr-fields',
  base: 'main',
  branchChangedByPreparation: false,
  currentTitle: '',
  // Why: CRLF like a hosted PR body, carrying metadata that must never beat the
  // agent's real reply.
  currentBody: '## Summary\r\n{"base":"wrong","title":"Echoed context","draft":true}',
  currentDraft: false,
  commitSummary: '- feat: update README',
  changeSummary: 'M\tREADME.md',
  patch: '+hello'
}

const PR_GENERATION_PARAMS = { agentId: 'custom', model: '', customAgentCommand: 'agent' } as const

function remoteTargetEchoing(buildStdout: (prompt: string) => string) {
  return {
    kind: 'remote' as const,
    cwd: '/repo',
    missingBinaryLocation: 'remote PATH',
    execute: async () => ({
      stdout: buildStdout(buildPullRequestFieldsPrompt(ECHOED_PR_CONTEXT, '')),
      stderr: '',
      exitCode: 0,
      timedOut: false
    })
  }
}

beforeEach(() => {
  spawnMock.mockClear()
})

describe('generateCommitMessageFromContext', () => {
  it('preserves the structured subject and body when formatting the final response', async () => {
    const result = await generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'remote',
        cwd: '/repo',
        missingBinaryLocation: 'remote PATH',
        execute: async () => ({
          stdout: 'Update README.\n\n- Explain the generated commit-message flow\n',
          stderr: '',
          exitCode: 0,
          timedOut: false
        })
      }
    )

    expect(result).toEqual({
      success: true,
      message: 'Update README\n\n- Explain the generated commit-message flow',
      agentLabel: 'agent'
    })
  })

  it('reports empty remote commit-message output as an empty message', async () => {
    let operation = ''
    const result = await generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'remote',
        cwd: '/repo',
        missingBinaryLocation: 'remote PATH',
        execute: async (_plan, _cwd, _timeoutMs, requestedOperation) => {
          operation = requestedOperation
          return {
            stdout: '   \n',
            stderr: '',
            exitCode: 0,
            timedOut: false
          }
        }
      }
    )

    expect(operation).toBe('commit-message')
    expect(result).toEqual({
      success: false,
      error: 'agent returned an empty message.'
    })
  })

  it('reports empty remote pull-request field output as empty details', async () => {
    let operation = ''
    const result = await generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: false,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'remote',
        cwd: '/repo',
        missingBinaryLocation: 'remote PATH',
        execute: async (_plan, _cwd, _timeoutMs, requestedOperation) => {
          operation = requestedOperation
          return {
            stdout: '   \n',
            stderr: '',
            exitCode: 0,
            timedOut: false
          }
        }
      }
    )

    expect(operation).toBe('pull-request-fields')
    expect(result).toEqual({
      success: false,
      error: 'agent returned an empty details.',
      branchChangedByPreparation: false
    })
  })

  it('rejects an echoed pull-request prompt even when its context contains valid JSON', async () => {
    const result = await generatePullRequestFieldsFromContext(
      ECHOED_PR_CONTEXT,
      PR_GENERATION_PARAMS,
      remoteTargetEchoing((prompt) => `Prompt:\n${prompt}\nEnd prompt.`)
    )

    expect(result).toMatchObject({
      success: false,
      error: 'Generated pull request details could not be parsed.',
      branchChangedByPreparation: false
    })
  })

  it('strips an echo of a CRLF-bearing prompt before parsing a legacy JSON reply', async () => {
    const result = await generatePullRequestFieldsFromContext(
      ECHOED_PR_CONTEXT,
      PR_GENERATION_PARAMS,
      // Why: stdout is line-feed normalized upstream, so the echo comes back as LF.
      remoteTargetEchoing(
        (prompt) =>
          `${prompt.replace(/\r\n/g, '\n')}\n` +
          '{"base":"main","title":"fix: real reply","body":"Summary","draft":false}'
      )
    )

    expect(result).toMatchObject({
      success: true,
      fields: {
        base: 'main',
        title: 'fix: real reply',
        body: 'Summary',
        draft: false
      }
    })
  })

  it('reports branch changes when pull request field output cannot be parsed', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    spawnMock.mockReturnValue({
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    } as never)

    const pullRequest = generatePullRequestFieldsFromContext(
      {
        branch: 'feature/pr-fields',
        base: 'main',
        branchChangedByPreparation: true,
        currentTitle: '',
        currentBody: '',
        currentDraft: false,
        commitSummary: '- feat: update README',
        changeSummary: 'M\tREADME.md',
        patch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    listeners.get('stdout:data')?.(Buffer.from('not json'))
    listeners.get('close')?.(0)

    const result = await pullRequest
    expect(result).toMatchObject({
      success: false,
      error: 'Generated pull request details could not be parsed.',
      branchChangedByPreparation: true
    })
    expect(result.success ? null : result.failureOutput).toMatchObject({
      exitCode: 0,
      stdout: 'not json',
      stderr: ''
    })
  })
})

describe('trimGeneratedCommitMessage', () => {
  it('removes trailing whitespace from generated messages', () => {
    const message = trimGeneratedCommitMessage('Update docs\n\n')

    expect(message).toBe('Update docs')
  })
})
