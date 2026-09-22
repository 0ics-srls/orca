import { describe, expect, it } from 'vitest'
import {
  asBrowserHistoryNavigateCommand,
  asBrowserPageCommandTarget,
  asBrowserPageZoomCommand
} from './browser-page-command-target'

describe('asBrowserPageCommandTarget', () => {
  it('admits a page id and drops unrelated fields', () => {
    expect(asBrowserPageCommandTarget({ browserPageId: 'page-a', extra: 1 })).toEqual({
      browserPageId: 'page-a'
    })
  })

  it.each([undefined, null, 'page-a', ['page-a'], {}, { browserPageId: '' }, { browserPageId: 7 }])(
    'rejects %j',
    (value) => {
      expect(asBrowserPageCommandTarget(value)).toBeNull()
    }
  )
})

describe('asBrowserHistoryNavigateCommand', () => {
  it('admits back and forward for a page', () => {
    expect(asBrowserHistoryNavigateCommand({ browserPageId: 'page-a', direction: 'back' })).toEqual(
      { browserPageId: 'page-a', direction: 'back' }
    )
    expect(
      asBrowserHistoryNavigateCommand({ browserPageId: 'page-a', direction: 'forward' })
    ).toEqual({ browserPageId: 'page-a', direction: 'forward' })
  })

  it.each([
    'back',
    { direction: 'back' },
    { browserPageId: '', direction: 'back' },
    { browserPageId: 'page-a' },
    { browserPageId: 'page-a', direction: 'up' }
  ])('rejects %j', (value) => {
    expect(asBrowserHistoryNavigateCommand(value)).toBeNull()
  })
})

describe('asBrowserPageZoomCommand', () => {
  it.each(['in', 'out', 'reset'] as const)('admits %s for a page', (direction) => {
    expect(asBrowserPageZoomCommand({ browserPageId: 'page-a', direction })).toEqual({
      browserPageId: 'page-a',
      direction
    })
  })

  it.each([
    'in',
    [{ browserPageId: 'page-a', direction: 'in' }],
    { direction: 'in' },
    { browserPageId: 'page-a' },
    { browserPageId: 'page-a', direction: 'back' }
  ])('rejects %j', (value) => {
    expect(asBrowserPageZoomCommand(value)).toBeNull()
  })
})
