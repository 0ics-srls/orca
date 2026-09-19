import { describe, expect, it } from 'vitest'
import {
  _getRuntimeEnvironmentTransportGenerationCacheSize,
  advanceRuntimeEnvironmentTransportGeneration
} from './runtime-environment-transport-generation'

describe('runtime environment transport generations', () => {
  it('bounds retired environment generations', () => {
    for (let index = 0; index < 600; index += 1) {
      advanceRuntimeEnvironmentTransportGeneration(`retired-environment-${index}`)
    }

    expect(_getRuntimeEnvironmentTransportGenerationCacheSize()).toBeLessThanOrEqual(512)
  })
})
