// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushWorktreePointerDragFrame, type WorktreePointerDragFrameArgs } from './pointer-flush'
import { NO_WORKTREE_SIDEBAR_DROP_TARGET, WORKTREE_ROW_DRAG_INITIAL_STATE } from './row-state'

vi.mock('../../workspace-kanban-sidebar-drop', () => ({
  clearWorkspaceKanbanSidebarDropTargetVisual: vi.fn(),
  hasWorkspaceKanbanSidebarDropBoard: () => true,
  isWorkspaceKanbanSidebarDropPointInBoard: () => false,
  updateWorkspaceKanbanSidebarDropTargetVisual: () => ({ status: null, isPinDrop: false })
}))

afterEach(() => vi.restoreAllMocks())

function setup() {
  let time = 0
  let nextFrame: FrameRequestCallback | null = null
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback
    return 1
  })
  let state = WORKTREE_ROW_DRAG_INITIAL_STATE
  let target = NO_WORKTREE_SIDEBAR_DROP_TARGET
  const offsets = new Map([['parent', 56]])
  const args: WorktreePointerDragFrameArgs = {
    drag: {
      pointerId: 1,
      sourceRow: document.createElement('div'),
      startX: 100,
      startY: 400,
      currentX: 100,
      currentY: 300,
      worktreeId: 'child',
      draggedIds: ['child'],
      reorderDraggedIds: ['child'],
      reorderUnitDraggedIds: ['child'],
      sourceGroupKey: 'repo',
      rects: [],
      active: true,
      preview: document.createElement('div'),
      previewOffsetX: 20,
      previewOffsetY: 20,
      workspaceBoardDragPreviewRequested: false,
      frameId: null,
      reorderIntent: null,
      latestBoardDropTarget: null,
      latestStatusDropTarget: null
    },
    ctx: {
      scrollRef: { current: null },
      workspaceStatuses: [],
      worktreeDragGroups: [],
      worktreeDragUnitGroups: [],
      refreshWorktreeDragSession: () => true,
      getEligibleLineageDropTarget: () => target,
      computeWorktreeDrop: () => ({
        dropIndex: 1,
        dropIndicatorY: 300,
        dropAnchorId: 'parent',
        previewOffsetsByWorktreeId: offsets
      }),
      computeWorktreeStatusDrop: () => null,
      commitWorktreeLineageParentDrop: () => true,
      clearReorderedWorktreeParents: vi.fn(),
      clearWorktreeDrag: vi.fn(),
      onMoveWorktreesToStatus: vi.fn(),
      onMoveWorktreesToStatusAtIndex: vi.fn(),
      onReorderWorktrees: vi.fn(),
      onPinWorktrees: vi.fn()
    },
    workspaceBoardOpen: false,
    onWorkspaceBoardDragPreviewStart: vi.fn(),
    onWorkspaceBoardDragPreviewCommit: vi.fn(),
    shouldShowWorkspaceBoardDropIndicator: () => false,
    setDragOverStatus: vi.fn(),
    setPinDragOver: vi.fn(),
    setWorktreeDragState: (update) => {
      state = typeof update === 'function' ? update(state) : update
    }
  }
  return {
    args,
    offsets,
    state: () => state,
    nest: (id: string | null) => {
      target = { ...NO_WORKTREE_SIDEBAR_DROP_TARGET, lineageParentId: id }
    },
    tick: (ms: number) => {
      time += ms
      const callback = nextFrame
      nextFrame = null
      callback?.(time)
    }
  }
}

describe('combined nesting and animated reordering', () => {
  it('lets the pointer cross an edge into nesting without moving the destination', () => {
    const t = setup()
    flushWorktreePointerDragFrame(t.args)
    expect(t.state().previewOffsetsByWorktreeId.size).toBe(0)
    t.nest('parent')
    t.tick(80)
    expect(t.state().lineageDropTargetId).toBe('parent')
    expect(t.state().previewOffsetsByWorktreeId.size).toBe(0)
    t.tick(200)
    expect(t.state().lineageDropTargetId).toBe('parent')
    expect(t.state().dropIndicatorY).toBeNull()
  })

  it('opens the reorder gap, holds it during nesting, then restores the edge preview', () => {
    const t = setup()
    flushWorktreePointerDragFrame(t.args)
    t.tick(160)
    expect(t.state().previewOffsetsByWorktreeId).toBe(t.offsets)
    expect(t.state().dropIndicatorY).toBe(300)
    t.nest('parent')
    flushWorktreePointerDragFrame(t.args)
    expect(t.state().lineageDropTargetId).toBe('parent')
    expect(t.state().previewOffsetsByWorktreeId).toBe(t.offsets)
    expect(t.state().dropIndicatorY).toBeNull()
    t.nest(null)
    flushWorktreePointerDragFrame(t.args)
    t.tick(160)
    expect(t.state().lineageDropTargetId).toBeNull()
    expect(t.state().previewOffsetsByWorktreeId).toBe(t.offsets)
    expect(t.state().dropIndicatorY).toBe(300)
  })

  it('clears the old line during a new intent and stops scheduling after settling', () => {
    const t = setup()
    flushWorktreePointerDragFrame(t.args)
    t.tick(160)
    expect(t.state().dropIndicatorY).toBe(300)
    t.args.ctx.computeWorktreeDrop = () => ({
      dropIndex: 2,
      dropIndicatorY: 356,
      dropAnchorId: null,
      previewOffsetsByWorktreeId: t.offsets
    })
    flushWorktreePointerDragFrame(t.args)
    expect(t.state().dropIndicatorY).toBeNull()
    expect(t.state().previewOffsetsByWorktreeId).toBe(t.offsets)
    t.tick(160)
    expect(t.state().dropIndicatorY).toBe(356)
    const frames = vi.mocked(window.requestAnimationFrame).mock.calls.length
    t.tick(1000)
    expect(vi.mocked(window.requestAnimationFrame).mock.calls).toHaveLength(frames)
  })
})
