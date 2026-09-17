import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import base from '../../../config/vitest.config'

const { verifySources } = createRequire(import.meta.url)('./sources.cjs')
verifySources()

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/audits/runtime-memory-body-issues/*.test.mjs']
  }
})
