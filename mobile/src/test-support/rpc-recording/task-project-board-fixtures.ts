import { REPO_ID } from './task-item-fixtures'

/**
 * The GitHub Projects board the project families mount against: one issue row, one pull-request
 * row, and the table that holds both. Shared so a row looks the same to the detail hook, the field
 * hook and the merge hook, which is what makes their recordings comparable.
 */
export const PROJECT_HOST = 'github.enterprise.test'
export const PROJECT_REPO = { id: REPO_ID, displayName: 'Repo', path: '/repo' }

export const ISSUE_ROW = {
  id: 'item-1',
  itemType: 'ISSUE',
  content: {
    repository: 'owner/repo',
    number: 1,
    url: 'https://github.com/owner/repo/issues/1',
    state: 'OPEN',
    labels: [],
    assignees: [],
    issueType: null
  },
  fieldValuesByFieldId: {}
} as const

export const PR_ROW = {
  id: 'item-2',
  itemType: 'PULL_REQUEST',
  content: {
    repository: 'owner/repo',
    number: 2,
    url: 'https://github.com/owner/repo/pull/2',
    state: 'OPEN',
    labels: [],
    assignees: [],
    issueType: null
  },
  fieldValuesByFieldId: {}
} as const

export const STATUS_FIELD = {
  id: 'field-1',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: []
}

export const PROJECT_TABLE = {
  project: { id: 'project-1', title: 'Board', number: 3 },
  selectedView: { id: 'view-1', number: 1, name: 'Table', filter: '', layout: 'TABLE_LAYOUT' },
  fields: [STATUS_FIELD],
  rows: [ISSUE_ROW, PR_ROW]
}

/**
 * The GitHub Projects board: the project/view/table reads, one row's detail and metadata pickers,
 * and the row mutations. Every `github.project.*` reply carries its own `{ok, error}` envelope
 * inside an accepted result, which the board reads itself — the acceptance policy only decides
 * whether there is a payload to read at all.
 */
