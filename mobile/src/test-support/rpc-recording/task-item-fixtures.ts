/**
 * The task items and detail payloads the provider adapters mount against. Shared because the same
 * pull request has to look the same to the comment hook, the merge hook and the checks hook for
 * their recordings to be comparable; each field is one the mounted hooks actually read.
 */
export const REPO_ID = 'repo-1'

/** The one hosted repository every task family queries, shaped the way `isHostedTaskRepo` needs. */
export const HOSTED_REPO = { id: REPO_ID, displayName: 'Repo', path: '/repo', provider: 'github' }

export const GITHUB_PR_ITEM = {
  provider: 'github',
  title: 'A pull request',
  source: {
    id: 'github:pr:12',
    repoId: REPO_ID,
    number: 12,
    type: 'pr',
    state: 'open',
    labels: ['bug'],
    reviewRequests: [],
    latestReviews: [],
    reviewDecision: null
  }
} as const

export const GITHUB_ISSUE_ITEM = {
  provider: 'github',
  title: 'An issue',
  source: {
    id: 'github:issue:9',
    repoId: REPO_ID,
    number: 9,
    type: 'issue',
    state: 'open',
    labels: ['bug'],
    reviewRequests: []
  }
} as const

export const GITLAB_ISSUE_ITEM = {
  provider: 'gitlab',
  title: 'A GitLab issue',
  source: {
    id: 'gitlab:issue:4',
    repoId: REPO_ID,
    number: 4,
    type: 'issue',
    state: 'opened',
    labels: ['bug'],
    projectRef: 'group/project'
  }
} as const

export const GITLAB_MR_ITEM = {
  provider: 'gitlab',
  title: 'A merge request',
  source: {
    id: 'gitlab:mr:7',
    repoId: REPO_ID,
    number: 7,
    type: 'mr',
    state: 'opened',
    labels: [],
    projectRef: 'group/project'
  }
} as const

export const LINEAR_ITEM = {
  provider: 'linear',
  title: 'A Linear issue',
  source: {
    id: 'issue-1',
    workspaceId: 'linear-workspace',
    identifier: 'ENG-1',
    workspaceName: 'Workspace',
    url: '',
    description: '',
    labels: [],
    priority: 0,
    updatedAt: '2020-01-01T00:00:00.000Z',
    state: { name: 'Todo', type: 'unstarted', color: '#000000' },
    team: { id: 'team-1', key: 'ENG', name: 'Engineering', workspaceId: 'linear-workspace' },
    project: null,
    subIssues: []
  }
} as const

/** A PR review comment: has a path, a numeric line and a numeric id, so a reply is a review reply. */
export const REVIEW_COMMENT = {
  id: 501,
  author: 'octocat',
  body: 'please fix',
  createdAt: '2020-01-01T00:00:00.000Z',
  path: 'src/index.ts',
  line: 12,
  threadId: 'thread-1',
  isResolved: false
} as const

/** An issue comment: no path or line, so a reply falls back to a plain issue comment. */
export const ISSUE_COMMENT = {
  id: 'comment-2',
  author: 'octocat',
  body: 'a thought',
  createdAt: '2020-01-01T00:00:00.000Z'
} as const

export const DETAIL_FILE = {
  path: 'src/index.ts',
  oldPath: undefined,
  status: 'modified',
  additions: 2,
  deletions: 1,
  viewerViewedState: 'UNVIEWED'
} as const

export function githubDetailPayload(): Record<string, unknown> {
  return {
    provider: 'github',
    body: 'body',
    comments: [REVIEW_COMMENT, ISSUE_COMMENT],
    labels: ['bug'],
    assignees: ['octocat'],
    reviewDecision: null,
    reviewRequests: [],
    latestReviews: [],
    headSha: 'head-sha',
    baseSha: 'base-sha',
    pullRequestId: 'PR_kwDO',
    checks: [],
    files: [DETAIL_FILE]
  }
}

export function gitlabDetailPayload(): Record<string, unknown> {
  return {
    provider: 'gitlab',
    body: 'body',
    comments: [ISSUE_COMMENT],
    labels: ['bug'],
    assignees: [],
    pipelineJobs: []
  }
}

export function linearDetailPayload(): Record<string, unknown> {
  return {
    provider: 'linear',
    description: 'description',
    comments: [],
    labels: [],
    assignee: undefined,
    project: null,
    children: []
  }
}
