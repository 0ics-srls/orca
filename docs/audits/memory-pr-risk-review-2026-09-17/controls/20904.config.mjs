import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const sourcePath = 'src/renderer/src/components/editor/use-diff-section-model-lifecycle.ts'
const variant = process.env.REVIEW_VARIANT ?? 'base'
if (!['base', 'published'].includes(variant)) {
  throw new Error('Use REVIEW_VARIANT=base or published')
}
const revision =
  variant === 'base'
    ? '07c7606feebc850d8b82c8c85a6a7fda71f29f14'
    : '0a2a06068c0e7a1dda3fd053396cd2764edbfc1c'
const source = execFileSync('git', ['show', `${revision}:${sourcePath}`], { encoding: 'utf8' })
export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer/src') } },
  plugins: [
    {
      name: 'withdrawn-hook-control',
      enforce: 'pre',
      transform(code, id) {
        if (id.split('?')[0] === resolve(sourcePath)) {
          return source
        }
      }
    }
  ],
  test: {
    environment: 'happy-dom',
    execArgv: ['--no-experimental-webstorage'],
    include: ['docs/audits/memory-pr-risk-review-2026-09-17/controls/20904.control.test.tsx']
  }
})
