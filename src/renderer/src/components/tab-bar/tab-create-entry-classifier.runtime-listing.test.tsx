// @vitest-environment happy-dom
//
// Why: every other TabBarCreateEntry suite mocks useRuntimeFileListForWorktree, so the classifier
// has only ever been graded against hand-written RuntimeFileListState values. That is the same
// seam #21423 shipped a P0 through in the file explorer. These specs run the classifier on the
// listing the real hook returns, mocking only the IPC boundary.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { useRuntimeFileListForWorktree, type RuntimeFileListState } from '../quick-open-file-list'
import { getTabEntryOptions } from './tab-create-entry-classifier'

const listRuntimeFilesMock = vi.hoisted(() => vi.fn())
const cancelRuntimeFileListMock = vi.hoisted(() => vi.fn())
const searchRuntimeFilePathsMock = vi.hoisted(() => vi.fn())

vi.mock('@/runtime/runtime-file-client', () => ({
  listRuntimeFiles: listRuntimeFilesMock,
  cancelRuntimeFileList: cancelRuntimeFileListMock,
  searchRuntimeFilePaths: searchRuntimeFilePathsMock
}))

const initialAppState = useAppStore.getInitialState()
const WORKSPACE_KEY = folderWorkspaceKey('local-workspace')
const roots: Root[] = []

function seedLocalWorkspace(): void {
  const group: ProjectGroup = {
    id: 'local-group',
    name: 'local-group',
    parentPath: '/local/proj',
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
  const workspace: FolderWorkspace = {
    id: 'local-workspace',
    projectGroupId: 'local-group',
    name: 'local-workspace',
    folderPath: '/local/proj',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 0,
    createdAt: 1,
    updatedAt: 1
  }
  const seeded: Partial<AppState> = {
    folderWorkspaces: [workspace],
    projectGroups: [group],
    repos: [],
    worktreesByRepo: {}
  }
  useAppStore.setState(seeded)
}

function HookProbe({
  onState,
  worktreeId
}: {
  onState: (state: RuntimeFileListState) => void
  worktreeId: string
}): null {
  onState(useRuntimeFileListForWorktree({ enabled: true, worktreeId }))
  return null
}

/** Render the real list hook and return its settled state, the way TabBarCreateEntry consumes it. */
async function settledFileList(): Promise<RuntimeFileListState> {
  const states: RuntimeFileListState[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      createElement(HookProbe, {
        worktreeId: WORKSPACE_KEY,
        onState: (state: RuntimeFileListState) => states.push(state)
      })
    )
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  const settled = states.at(-1)
  if (!settled) {
    throw new Error('the file list hook never rendered')
  }
  return settled
}

beforeEach(() => {
  useAppStore.setState(initialAppState, true)
  listRuntimeFilesMock.mockReset().mockResolvedValue(['packages/app/package.json', 'src/main.ts'])
  cancelRuntimeFileListMock.mockReset()
  searchRuntimeFilePathsMock.mockReset().mockResolvedValue({ files: [], truncated: false })
  seedLocalWorkspace()
})

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount()
    })
  }
  roots.length = 0
  useAppStore.setState(initialAppState, true)
})

describe('tab entry options over the real runtime listing', () => {
  it('offers a listed file once the real listing settles', async () => {
    const fileList = await settledFileList()

    expect(fileList.loading).toBe(false)
    expect(fileList.files).toEqual(['packages/app/package.json', 'src/main.ts'])

    const options = getTabEntryOptions('packages/app/package.json', fileList, 4)
    const existing = options.find((option) => option.classification.kind === 'existing-file')

    expect(existing?.classification).toMatchObject({
      kind: 'existing-file',
      relativePath: 'packages/app/package.json'
    })
  })

  // A listing the hook fetched but hid would leave the entry stuck on its loading placeholder.
  it('does not report the settled listing as still loading', async () => {
    const fileList = await settledFileList()
    const options = getTabEntryOptions('packages/app/package.json', fileList, 4)
    const blockedIds = options
      .filter((option) => option.classification.kind === 'blocked')
      .map((option) => option.id)

    expect(blockedIds).not.toContain('loading')
  })

  it('treats a path absent from the real listing as a new file', async () => {
    const fileList = await settledFileList()
    const options = getTabEntryOptions('src/not-listed-yet.ts', fileList, 4)

    expect(
      options.find((option) => option.classification.kind === 'new-file')?.classification
    ).toMatchObject({ kind: 'new-file', relativePath: 'src/not-listed-yet.ts' })
  })
})
