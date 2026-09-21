import { describe, expect, it } from 'vitest'
import { hostPlatformLabel } from './host-platform-label'

describe('hostPlatformLabel', () => {
  it('uses names people recognize for supported host platforms', () => {
    expect(hostPlatformLabel('darwin')).toBe('macOS')
    expect(hostPlatformLabel('win32')).toBe('Windows')
    expect(hostPlatformLabel('linux')).toBe('Linux')
  })

  it('does not invent a label when the host did not publish a platform', () => {
    expect(hostPlatformLabel(null)).toBeNull()
    expect(hostPlatformLabel(undefined)).toBeNull()
  })
})
