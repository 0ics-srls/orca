import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PULL_REQUEST_BODY_MARKER,
  PULL_REQUEST_END_MARKER,
  PULL_REQUEST_FIELDS_MARKER
} from './pull-request-fields-envelope'
import {
  buildPullRequestFieldsPrompt,
  GENERATED_PULL_REQUEST_JSON_STRUCTURE_LIMITS,
  parseGeneratedPullRequestFields,
  type PullRequestDraftContext
} from './pull-request-generation'

const context: PullRequestDraftContext = {
  branch: 'feature/pr-details',
  base: 'main',
  branchChangedByPreparation: false,
  currentTitle: 'Feature pr details',
  currentBody: '- Add form',
  currentDraft: false,
  commitSummary: '- feat: add generated PR details',
  changeSummary: 'M\tsrc/file.ts',
  patch: 'diff --git a/src/file.ts b/src/file.ts\n+export const value = true'
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildPullRequestFieldsPrompt', () => {
  it('asks for the marker envelope and includes PR context', () => {
    const prompt = buildPullRequestFieldsPrompt(context, 'Use conventional PR titles.')

    expect(prompt).toContain('Return ONLY this envelope')
    expect(prompt).toContain(PULL_REQUEST_FIELDS_MARKER)
    expect(prompt).toContain(PULL_REQUEST_BODY_MARKER)
    expect(prompt).toContain(PULL_REQUEST_END_MARKER)
    expect(prompt).toContain('raw markdown, no escaping, no JSON')
    expect(prompt).toContain('Head branch: feature/pr-details')
    expect(prompt).toContain('Current base: main')
    expect(prompt).toContain('Additional user prompt:')
    expect(prompt).toContain('Use conventional PR titles.')
  })

  it('requires ELI5 problem and solution content before implementation details', () => {
    const prompt = buildPullRequestFieldsPrompt(context, '')

    expect(prompt).toContain('explain the problem first, then the solution')
    expect(prompt).toContain('simple ELI5 language before details')
  })

  it('makes existing sections win over the mandated Problem and Solution headings', () => {
    const prompt = buildPullRequestFieldsPrompt(context, '')

    expect(prompt).toContain('Current description wins on structure')
    expect(prompt).toContain('write that content into it instead of adding a second heading')
    expect(prompt).toContain(
      'Only when no existing section covers them, add `## Problem` then `## Solution`'
    )
  })

  it('includes GitHub issue details and complete or partial reference guidance', () => {
    const prompt = buildPullRequestFieldsPrompt(
      {
        ...context,
        provider: 'github',
        linkedIssueDetails: {
          provider: 'github',
          number: 12398,
          title: 'Stop phantom polling',
          description: 'Helpers repeatedly stat Linux-only PATH entries.'
        }
      },
      ''
    )

    expect(prompt).toContain('Linked GitHub issue: #12398 Stop phantom polling')
    expect(prompt).toContain('Issue description:\nHelpers repeatedly stat Linux-only PATH entries.')
    expect(prompt).toContain('`Fixes #12398` only for a complete fix')
    expect(prompt).toContain('use `Refs #12398`')
  })

  it('uses GitLab-specific issue references', () => {
    const prompt = buildPullRequestFieldsPrompt(
      {
        ...context,
        provider: 'gitlab',
        linkedIssueDetails: {
          provider: 'gitlab',
          number: 42,
          title: 'Fix runner polling',
          description: 'The runner checks paths that cannot exist.'
        }
      },
      ''
    )

    expect(prompt).toContain('Linked GitLab issue: #42 Fix runner polling')
    expect(prompt).toContain('`Closes #42` only for a complete fix')
    expect(prompt).toContain('use `Related to #42`')
    expect(prompt).not.toContain('GitHub issue')
  })

  it('uses the active provider when no issue is linked', () => {
    const prompt = buildPullRequestFieldsPrompt({ ...context, provider: 'bitbucket' }, '')

    expect(prompt).toContain('Linked Bitbucket issue: (none)')
    expect(prompt).toContain('No Bitbucket issue is linked; do not invent an issue number')
    expect(prompt).not.toContain('GitHub issue')
  })

  it('uses Azure DevOps work-item syntax', () => {
    const prompt = buildPullRequestFieldsPrompt(
      {
        ...context,
        provider: 'azure-devops',
        linkedIssueDetails: {
          provider: 'azure-devops',
          number: 99,
          title: 'Stop unnecessary polling',
          description: 'Avoid checks for unavailable tools.'
        }
      },
      ''
    )

    expect(prompt).toContain('Linked Azure DevOps issue: AB#99 Stop unnecessary polling')
    expect(prompt).toContain('`Fixes AB#99` only for a complete fix')
    expect(prompt).toContain('use `AB#99`')
  })

  it('says what to do with an unfilled issue-reference stub', () => {
    const prompt = buildPullRequestFieldsPrompt(
      { ...context, provider: 'github', currentBody: '## Summary\n\nFixes #' },
      ''
    )

    expect(prompt).toContain(
      'Leave a bare reference stub from Current description (for example `Fixes #`) exactly as it stands'
    )
    expect(prompt).toContain('do not fill it in, and do not delete it')
  })

  it('tells the agent to preserve existing review templates', () => {
    const prompt = buildPullRequestFieldsPrompt(
      {
        ...context,
        currentBody: '## Summary\n\n## Testing\n\n- [ ] Required checks'
      },
      ''
    )

    expect(prompt).toContain('keep every heading, required section and checklist')
    expect(prompt).toContain('Leave genuinely unknown template items as TODO or unchecked')
  })
})

const MARKDOWN_BODY = [
  '## Problem',
  '',
  'The parser died on prose that said "something went wrong" instead of failing softly.',
  '',
  '## Solution',
  '',
  'Use `base`, `title` and a raw body:',
  '',
  '```json',
  '{"still":"fine, even nested \\"quotes\\""}',
  '```',
  '',
  '### Checklist',
  '',
  '- [x] Quotes survive',
  '- [ ] TODO: nothing left',
  '',
  '> A quote block with a trailing backtick `'
].join('\n')

function envelopeReply(body: string, newline = '\n'): string {
  return [
    PULL_REQUEST_FIELDS_MARKER,
    'base: main',
    'title: fix: keep the body raw.',
    'draft: false',
    PULL_REQUEST_BODY_MARKER,
    body,
    PULL_REQUEST_END_MARKER
  ].join(newline)
}

describe('parseGeneratedPullRequestFields envelope replies', () => {
  it('keeps a markdown body with quotes, fences, headings and checklists byte-intact', () => {
    const fields = parseGeneratedPullRequestFields(envelopeReply(MARKDOWN_BODY), context)

    expect(fields).toEqual({
      base: 'main',
      title: 'fix: keep the body raw',
      body: MARKDOWN_BODY,
      draft: false
    })
    expect(fields.body).toContain('"something went wrong"')
  })

  it('keeps the body intact across a CRLF reply', () => {
    const crlfBody = MARKDOWN_BODY.replace(/\n/g, '\r\n')
    const fields = parseGeneratedPullRequestFields(envelopeReply(crlfBody, '\r\n'), context)

    expect(fields.body).toBe(crlfBody)
    expect(fields.base).toBe('main')
    expect(fields.draft).toBe(false)
  })

  it('unwraps an envelope the model wrapped in a code fence', () => {
    const fields = parseGeneratedPullRequestFields(
      `\`\`\`text\n${envelopeReply(MARKDOWN_BODY)}\n\`\`\``,
      context
    )

    expect(fields.body).toBe(MARKDOWN_BODY)
    expect(fields.title).toBe('fix: keep the body raw')
  })

  it('reads the body to the end of the reply when the end marker is missing', () => {
    const fields = parseGeneratedPullRequestFields(
      [
        PULL_REQUEST_FIELDS_MARKER,
        'base: release/2.0',
        'title: Ship it',
        'draft: true',
        PULL_REQUEST_BODY_MARKER,
        '## Problem',
        '',
        'Still parses.'
      ].join('\n'),
      context
    )

    expect(fields).toEqual({
      base: 'release/2.0',
      title: 'Ship it',
      body: '## Problem\n\nStill parses.',
      draft: true
    })
  })

  it('ignores prose around the envelope and unwraps quoted header values', () => {
    const fields = parseGeneratedPullRequestFields(
      [
        'Sure — here are the details:',
        PULL_REQUEST_FIELDS_MARKER,
        'base: "main"',
        'title: `Quoted title`',
        'draft: FALSE',
        PULL_REQUEST_BODY_MARKER,
        'Body stays raw.',
        PULL_REQUEST_END_MARKER,
        'Let me know if you want changes.'
      ].join('\n'),
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'Quoted title',
      body: 'Body stays raw.',
      draft: false
    })
  })

  it('falls back to context values for header fields the model omitted', () => {
    const fields = parseGeneratedPullRequestFields(
      [PULL_REQUEST_FIELDS_MARKER, PULL_REQUEST_BODY_MARKER, 'Only a body.'].join('\n'),
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'Feature pr details',
      body: 'Only a body.',
      draft: false
    })
  })

  it('never runs the JSON path for an envelope body that looks like JSON', () => {
    const parseSpy = vi.spyOn(JSON, 'parse')
    const fields = parseGeneratedPullRequestFields(
      envelopeReply('{"base":"other","title":"not read"}'),
      context
    )

    expect(fields.body).toBe('{"base":"other","title":"not read"}')
    expect(fields.base).toBe('main')
    expect(parseSpy).not.toHaveBeenCalled()
  })
})

describe('parseGeneratedPullRequestFields', () => {
  it('parses fenced JSON output', () => {
    const fields = parseGeneratedPullRequestFields(
      '```json\n{"base":"main","title":"fix: add details.","body":"Summary","draft":true}\n```',
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'fix: add details',
      body: 'Summary',
      draft: true
    })
  })

  it('parses CRLF fenced JSON output without full-string fence matching', () => {
    const matchSpy = vi.spyOn(String.prototype, 'match')
    const replaceSpy = vi.spyOn(String.prototype, 'replace')
    const fields = parseGeneratedPullRequestFields(
      '```JSON\r\n{"base":"main","title":"fix: add details.","body":"Summary","draft":true}\r\n```',
      context
    )

    expect(fields.title).toBe('fix: add details')
    const usedFenceMatch = matchSpy.mock.calls.some(
      ([pattern]) =>
        pattern instanceof RegExp &&
        pattern.source.startsWith('^```') &&
        pattern.source.includes('[\\s\\S]')
    )
    const usedCrlfReplace = replaceSpy.mock.calls.some(
      ([pattern]) => pattern instanceof RegExp && pattern.source === '\\r\\n' && pattern.global
    )
    expect(usedFenceMatch).toBe(false)
    expect(usedCrlfReplace).toBe(false)
  })

  it('falls back for missing optional values', () => {
    const fields = parseGeneratedPullRequestFields('{"title":""}', context)

    expect(fields).toEqual({
      base: 'main',
      title: 'Feature pr details',
      body: '- Add form',
      draft: false
    })
  })

  it('keeps an explicitly empty body instead of falling back', () => {
    const fields = parseGeneratedPullRequestFields(
      '{"base":"main","title":"chore: add new app config","body":"","draft":false}',
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'chore: add new app config',
      body: '',
      draft: false
    })
  })

  it('parses a prose-wrapped JSON reply', () => {
    const fields = parseGeneratedPullRequestFields(
      'Here are the details:\n{"base":"main","title":"fix: wrap","body":"Summary","draft":false}\nHope that helps!',
      context
    )

    expect(fields).toEqual({
      base: 'main',
      title: 'fix: wrap',
      body: 'Summary',
      draft: false
    })
  })

  it('throws on a reply that is neither an envelope nor JSON, so the caller can capture it', () => {
    expect(() =>
      parseGeneratedPullRequestFields('I could not generate pull request details.', context)
    ).toThrow()
  })

  it('rejects excessive nesting before JSON.parse', () => {
    const parseSpy = vi.spyOn(JSON, 'parse')
    const depth = GENERATED_PULL_REQUEST_JSON_STRUCTURE_LIMITS.nestingDepth + 1
    try {
      expect(() =>
        parseGeneratedPullRequestFields(`${'['.repeat(depth)}0${']'.repeat(depth)}`, context)
      ).toThrow(/JSON nesting exceeds/)
      expect(parseSpy).not.toHaveBeenCalled()
    } finally {
      parseSpy.mockRestore()
    }
  })
})
