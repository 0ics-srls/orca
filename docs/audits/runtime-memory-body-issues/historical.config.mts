import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import base from '../../../config/vitest.config'

const { readReportedTarget } = createRequire(import.meta.url)('./sources.cjs')
const target = resolve('src/main/runtime/orca-runtime-refresh-repo-worktree-scan.ts')
const reported = readReportedTarget()

export default defineConfig({
  ...base,
  plugins: [
    {
      name: 'reported-v197-refresh',
      enforce: 'pre',
      transform(_code, id) {
        return resolve(id.split('?')[0]) === target ? { code: reported, map: null } : undefined
      }
    }
  ],
  test: {
    ...base.test,
    include: ['docs/audits/runtime-memory-body-issues/fingerprint-repetition.test.mjs']
  }
})
