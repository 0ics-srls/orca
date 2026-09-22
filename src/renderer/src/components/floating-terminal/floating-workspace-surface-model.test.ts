import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'
import { resolveFloatingWorkspaceSurfaceModel } from './floating-workspace-surface-model'

const FLOATING = FLOATING_TERMINAL_WORKTREE_ID

function makeTab(id: string, groupId: string): Tab {
  return {
    id,
    entityId: `entity-${id}`,
    contentType: 'terminal',
    worktreeId: FLOATING,
    groupId,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeGroup(id: string, overrides: Partial<TabGroup> = {}): TabGroup {
  return { id, worktreeId: FLOATING, activeTabId: null, tabOrder: [], ...overrides }
}

const LEAF: TabGroupLayoutNode = { type: 'leaf', groupId: 'group-1' }

function makeState(overrides: {
  tabs?: Tab[]
  groups?: TabGroup[]
  layout?: TabGroupLayoutNode
  focusedGroupId?: string
}): Parameters<typeof resolveFloatingWorkspaceSurfaceModel>[0] {
  const unifiedTabsByWorktree: Record<string, Tab[]> = {}
  const groupsByWorktree: Record<string, TabGroup[]> = {}
  const layoutByWorktree: Record<string, TabGroupLayoutNode> = {}
  const activeGroupIdByWorktree: Record<string, string> = {}
  if (overrides.tabs) {
    unifiedTabsByWorktree[FLOATING] = overrides.tabs
  }
  if (overrides.groups) {
    groupsByWorktree[FLOATING] = overrides.groups
  }
  if (overrides.layout) {
    layoutByWorktree[FLOATING] = overrides.layout
  }
  if (overrides.focusedGroupId) {
    activeGroupIdByWorktree[FLOATING] = overrides.focusedGroupId
  }
  return { unifiedTabsByWorktree, groupsByWorktree, layoutByWorktree, activeGroupIdByWorktree }
}

describe('resolveFloatingWorkspaceSurfaceModel', () => {
  it('is empty until the first tab exists', () => {
    expect(resolveFloatingWorkspaceSurfaceModel(makeState({}))).toEqual({ kind: 'empty' })
  })

  it('is empty when tabs exist but no layout does (defensive: creation writes both)', () => {
    expect(
      resolveFloatingWorkspaceSurfaceModel(
        makeState({ tabs: [makeTab('t1', 'group-1')], groups: [makeGroup('group-1')] })
      )
    ).toEqual({ kind: 'empty' })
  })

  it('mounts the workspace with the stored focused group', () => {
    expect(
      resolveFloatingWorkspaceSurfaceModel(
        makeState({
          tabs: [makeTab('t1', 'group-1')],
          groups: [makeGroup('group-1'), makeGroup('group-2')],
          layout: LEAF,
          focusedGroupId: 'group-2'
        })
      )
    ).toEqual({ kind: 'workspace', layout: LEAF, focusedGroupId: 'group-2' })
  })

  it('falls back from a stale focused id to the group with an active tab', () => {
    expect(
      resolveFloatingWorkspaceSurfaceModel(
        makeState({
          tabs: [makeTab('t1', 'group-2')],
          groups: [makeGroup('group-1'), makeGroup('group-2', { activeTabId: 't1' })],
          layout: LEAF,
          focusedGroupId: 'group-gone'
        })
      )
    ).toEqual({ kind: 'workspace', layout: LEAF, focusedGroupId: 'group-2' })
  })

  it('falls back to the first group when none records an active tab', () => {
    expect(
      resolveFloatingWorkspaceSurfaceModel(
        makeState({
          tabs: [makeTab('t1', 'group-1')],
          groups: [makeGroup('group-1'), makeGroup('group-2')],
          layout: LEAF
        })
      )
    ).toEqual({ kind: 'workspace', layout: LEAF, focusedGroupId: 'group-1' })
  })
})
