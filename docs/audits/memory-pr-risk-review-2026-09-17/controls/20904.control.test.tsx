import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useDiffSectionModelLifecycle } from '@/components/editor/use-diff-section-model-lifecycle'

const state = vi.hoisted(() => ({ dispose: vi.fn(), attached: false }))
vi.mock('@/lib/monaco-setup', () => ({
  monaco: {
    Uri: { parse: (path: string) => path },
    editor: {
      getModel: () => ({ dispose: state.dispose, isAttachedToEditor: () => state.attached })
    }
  }
}))
function Section() {
  const { setSectionRootNode } = useDiffSectionModelLifecycle({
    modelPathBase: 'review-section',
    collapsed: false
  })
  return <div ref={setSectionRootNode} />
}
afterEach(() => {
  vi.useRealTimers()
  state.dispose.mockClear()
})
it('retires both kept section models after React unmount', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Section />))
  await act(async () => root.unmount())
  await vi.runAllTimersAsync()
  expect(state.dispose).toHaveBeenCalledTimes(2)
})
