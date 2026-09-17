import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import base from '../../../config/vitest.config.ts'

for (const source of JSON.parse(
  readFileSync(new URL('./source-versions.json', import.meta.url), 'utf8')
)) {
  const data = readFileSync(source.path, 'utf8').replaceAll('\r\n', '\n')
  if (createHash('sha256').update(data).digest('hex') !== source.workingSha256) {
    throw new Error(`Scanner audit source drift: ${source.path}`)
  }
}

export default {
  ...base,
  test: {
    ...base.test,
    maxWorkers: 1,
    include: ['docs/audits/scanner-shutdown-custody/custody.test.mjs']
  }
}
