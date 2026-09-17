import { afterEach, expect, it, vi } from 'vitest'
import {
  createTestStore,
  makeWorktree
} from '../../../src/renderer/src/store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../../../src/renderer/src/store/slices/store-session-test-harness'
import { buildEditorSessionData } from '../../../src/renderer/src/lib/workspace-session'
import type { OpenFile } from '../../../src/renderer/src/store/slices/editor/types/open-file'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
afterEach(() => vi.unstubAllGlobals())

const worktreeId = 'audit-repo::/audit-workspace'
function file(id: string): OpenFile {
  return {
    id,
    worktreeId,
    filePath: '/audit-workspace/same.txt',
    relativePath: 'same.txt',
    mode: 'edit',
    language: 'plaintext',
    isDirty: false,
    runtimeEnvironmentId: null
  }
}
function fixture() {
  createStoreSessionMockApi()
  const store = createTestStore()
  store.setState({
    repos: [
      {
        id: 'audit-repo',
        path: '/audit-workspace',
        displayName: 'Audit',
        badgeColor: 'gray',
        addedAt: 0,
        executionHostId: 'local'
      }
    ],
    worktreesByRepo: {
      'audit-repo': [
        makeWorktree({
          id: worktreeId,
          repoId: 'audit-repo',
          path: '/audit-workspace',
          hostId: 'local'
        })
      ]
    },
    activeWorktreeId: worktreeId,
    openFiles: [file('first'), file('second')],
    activeFileId: 'first',
    activeFileIdByWorktree: { [worktreeId]: 'first' },
    unifiedTabsByWorktree: {
      [worktreeId]: ['first', 'second'].map((id, index) => ({
        id: `tab-${id}`,
        entityId: id,
        worktreeId,
        groupId: 'audit-group',
        contentType: 'editor' as const,
        label: 'same.txt',
        customLabel: null,
        color: null,
        sortOrder: index,
        createdAt: 1
      }))
    },
    groupsByWorktree: {
      [worktreeId]: [
        {
          id: 'audit-group',
          worktreeId,
          activeTabId: 'tab-first',
          tabOrder: ['tab-first', 'tab-second'],
          recentTabIds: ['tab-first', 'tab-second']
        }
      ]
    },
    activeGroupIdByWorktree: { [worktreeId]: 'audit-group' }
  })
  return store
}

it('serializes two indistinguishable clean editor rows without their live IDs', () => {
  const records = buildEditorSessionData([file('first'), file('second')], {}, {}, {}, {})
    .openFilesByWorktree[worktreeId]
  expect(records).toHaveLength(2)
  expect(records[0]).toEqual(records[1])
  expect('id' in records[0]).toBe(false)
})

it('leaves a same-document sibling record and tab after closing one identity', () => {
  const store = fixture()
  store.getState().closeFile('first')
  expect(store.getState().openFiles.map((row) => row.id)).toEqual(['second'])
  expect(store.getState().unifiedTabsByWorktree[worktreeId].map((tab) => tab.entityId)).toEqual([
    'second'
  ])
  store.getState().setActiveFile('second')
  expect(store.getState().activeFileId).toBe('second')
})

it('accepts active-file identity even when no OpenFile backs it', () => {
  const store = fixture()
  store.getState().setActiveFile('missing-record')
  expect(store.getState().activeFileId).toBe('missing-record')
  expect(store.getState().openFiles.some((row) => row.id === 'missing-record')).toBe(false)
})

it('stamps an explicitly local file tab from active workspace focus', () => {
  const store = fixture()
  store.setState({ activeWorkspaceExecutionHostId: 'runtime:other-environment' })
  const tab = store.getState().createUnifiedTab(worktreeId, 'editor', { entityId: 'first' })
  expect(store.getState().openFiles.find((row) => row.id === 'first')?.runtimeEnvironmentId).toBe(
    null
  )
  expect(tab.executionHostId).toBe('runtime:other-environment')
})
