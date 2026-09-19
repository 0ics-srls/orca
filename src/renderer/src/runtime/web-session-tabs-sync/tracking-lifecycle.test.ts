import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearWebSessionTabsTrackingForEnvironment,
  getWebSessionTabsTrackingGeneration,
  resetWebSessionTabsSnapshotFreshnessForTests
} from './tracking-lifecycle'

describe('web session tabs tracking generations', () => {
  beforeEach(() => resetWebSessionTabsSnapshotFreshnessForTests())

  it('bounds retired environments without reopening an evicted fence', () => {
    for (let index = 0; index < 600; index += 1) {
      clearWebSessionTabsTrackingForEnvironment(`environment-${index}`)
    }

    expect(getWebSessionTabsTrackingGeneration('environment-0')).toBeGreaterThan(1)
    expect(getWebSessionTabsTrackingGeneration('environment-599')).toBe(1)
  })
})
