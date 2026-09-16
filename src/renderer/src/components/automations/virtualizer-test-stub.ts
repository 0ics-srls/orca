/**
 * happy-dom reports a zero-height scroll element, and `observeElementRect` hands
 * that measurement straight to the virtualizer — so the real `useVirtualizer`
 * renders no rows at all under test. This stub renders a bounded window instead,
 * which is what the virtualization assertions are actually about.
 */

type VirtualizerStubOptions = {
  count: number
  estimateSize: (index: number) => number
  getItemKey?: (index: number) => string | number
}

type VirtualizerStub = {
  getTotalSize: () => number
  getVirtualItems: () => { index: number; key: string | number; start: number; size: number }[]
  measureElement: (element: Element | null) => void
  scrollToIndex: (index: number) => void
}

export function createVirtualizerStub(
  windowSize = 21
): (options: VirtualizerStubOptions) => VirtualizerStub {
  return ({ count, estimateSize, getItemKey }) => {
    const sizes = Array.from({ length: count }, (_, index) => estimateSize(index))
    let offset = 0
    const starts = sizes.map((size) => {
      const start = offset
      offset += size
      return start
    })
    return {
      getTotalSize: () => sizes.reduce((total, size) => total + size, 0),
      getVirtualItems: () =>
        Array.from({ length: Math.min(count, windowSize) }, (_, index) => ({
          index,
          key: getItemKey?.(index) ?? index,
          start: starts[index] ?? 0,
          size: sizes[index] ?? 0
        })),
      measureElement: () => undefined,
      scrollToIndex: () => undefined
    }
  }
}
