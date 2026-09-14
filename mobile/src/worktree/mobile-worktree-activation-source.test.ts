import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../host-screen/use-host-worktree-actions.ts', import.meta.url),
  'utf8'
)
const operations = readFileSync(
  new URL('../host-screen/host-screen-operations.ts', import.meta.url),
  'utf8'
)

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('mobile worktree activation', () => {
  it('opens mobile sessions without foregrounding other paired clients', () => {
    const openSession = sliceBetween(
      'const openWorktreeSession = useCallback(',
      'const openFloatingWorkspace = useCallback'
    )

    expect(openSession).toContain('worktreeActivate')
    expect(openSession).toContain('notifyClients: false')
    expect(openSession).toContain("navigation: 'caller'")
    // The method moved into the operation; assert it there so the pair still pins the wire.
    expect(operations).toContain("method: 'worktree.activate'")
  })
})
