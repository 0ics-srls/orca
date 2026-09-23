import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BUNDLED_RIPGREP_PACKAGE_BIN_DIR, BUNDLED_RIPGREP_PLATFORMS } from './bundled-ripgrep'

const requireFromRoot = createRequire(`${process.cwd()}/`)

describe('bundled ripgrep platforms', () => {
  it('packages exactly the layout the runtime resolves', () => {
    const packaging: {
      BUNDLED_RIPGREP_PLATFORMS: string[]
      RIPGREP_PACKAGE_BIN_DIR: string
    } = requireFromRoot('./config/bundled-ripgrep-resources.cjs')

    expect(packaging.BUNDLED_RIPGREP_PLATFORMS).toEqual([...BUNDLED_RIPGREP_PLATFORMS])
    expect(packaging.RIPGREP_PACKAGE_BIN_DIR).toBe(BUNDLED_RIPGREP_PACKAGE_BIN_DIR)
  })
})
