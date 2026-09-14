import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = [
  readSource('./use-mobile-tasks-project-loading-actions.tsx'),
  readSource('./use-mobile-tasks-project-workspace-comment-actions.tsx'),
  readSource('./use-mobile-tasks-project-thread-reply-actions.tsx'),
  readSource('./use-mobile-tasks-project-detail-loading.tsx'),
  readSource('./use-mobile-tasks-project-metadata-actions.tsx'),
  readSource('./use-mobile-tasks-project-metadata-loading.tsx'),
  readSource('./use-mobile-tasks-project-review-check-actions.tsx'),
  readSource('./use-mobile-tasks-project-file-merge-actions.tsx')
].join('\n')
const boardOperations = readSource('./mobile-task-project-board-operations.ts')
const itemOperations = [
  readSource('./mobile-task-item-state-operations.ts'),
  readSource('./mobile-task-item-comment-operations.ts')
].join('\n')

/** The operation a board site sends now names the method, so the pin is in two halves: the
 *  site carries the host or the row identity, and the operation still sends that method. */
function sendsMethod(operations: string, operation: string, method: string): boolean {
  const offset = operations.indexOf(`export const ${operation} =`)
  return offset !== -1 && operations.slice(offset, offset + 400).includes(`method: '${method}'`)
}

describe('mobile GitHub Project host routing boundary', () => {
  it('host-qualifies every Project RPC request', () => {
    const calls = [...source.matchAll(/\b(githubProject[A-Za-z]+)\.request\(/g)]
    expect(calls.length).toBeGreaterThan(10)
    for (const call of calls) {
      const request = source.slice(call.index, call.index + 700)
      expect(request, `${call[1]} must carry a host`).toMatch(/\bhost\s*:/)
      expect(
        boardOperations.includes(`export const ${call[1]} =`),
        `${call[1]} must be a declared Project operation`
      ).toBe(true)
    }
  })

  it('pins Project-row PR actions to the row repository identity', () => {
    const actions = source.slice(source.indexOf('const toggleProjectGitHubReviewThread'))
    for (const [operation, method] of [
      ['githubReviewThreadResolve', 'github.resolveReviewThread'],
      ['githubReviewCommentReplyWrite', 'github.addPRReviewCommentReply'],
      ['githubIssueCommentWrite', 'github.addIssueComment'],
      ['githubReviewerRequest', 'github.requestPRReviewers'],
      ['githubPullRequestChecksRead', 'github.prChecks'],
      ['githubPullRequestChecksRerun', 'github.rerunPRChecks'],
      ['githubPullRequestFileViewedWrite', 'github.setPRFileViewed'],
      ['githubPullRequestFileContentsRead', 'github.prFileContents'],
      ['githubReviewCommentWrite', 'github.addPRReviewComment'],
      ['githubPullRequestMerge', 'github.mergePR']
    ] as const) {
      const offset = actions.indexOf(`${operation}.request(`)
      expect(offset, `${method} must remain wired in the Project action path`).toBeGreaterThan(-1)
      expect(actions.slice(offset, offset + 700), `${method} must carry prRepo`).toContain(
        'prRepo: projectRowGitHubRepository(row, activeGitHubProjectHost)'
      )
      expect(
        sendsMethod(itemOperations, operation, method),
        `${operation} must still send ${method}`
      ).toBe(true)
    }
  })

  it('pins discovery to github.com while pasted URLs supply their parsed host', () => {
    expect(source).toContain("githubProjectListRead.request(client, { host: 'github.com' })")
    expect(
      sendsMethod(boardOperations, 'githubProjectListRead', 'github.project.listAccessible')
    ).toBe(true)
    expect(source).toContain('host: githubProjectHost(parsed.host)')
  })
})
