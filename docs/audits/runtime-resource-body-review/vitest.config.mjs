import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import base from '../../../config/vitest.config.ts'

const versions = JSON.parse(
  readFileSync(new URL('./source-versions.json', import.meta.url), 'utf8')
)
const root = new URL('../../../', import.meta.url)
const fenced = new Map(
  versions.executedTargets.map(({ path, currentSha256 }) => [
    fileURLToPath(new URL(path, root)).replaceAll('\\', '/'),
    currentSha256
  ])
)

export default {
  ...base,
  test: {
    ...base.test,
    include: ['docs/audits/runtime-resource-body-review/*.test.mjs'],
    maxWorkers: 1
  },
  plugins: [
    {
      name: 'runtime-resource-audit-source-fences',
      enforce: 'pre',
      transform(source, id) {
        const expected = fenced.get(id.split('?')[0].replaceAll('\\', '/'))
        if (
          expected &&
          createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex') !== expected
        ) {
          throw new Error(`Audited source changed: ${id}`)
        }
        return null
      }
    }
  ]
}
