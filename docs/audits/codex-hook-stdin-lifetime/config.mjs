import base from '../../../config/vitest.config.ts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const versions = JSON.parse(
  readFileSync('docs/audits/codex-hook-stdin-lifetime/source-versions.json', 'utf8')
)
for (const [path, expected] of Object.entries(versions.currentPaths)) {
  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
  if (createHash('sha256').update(source).digest('hex') !== expected) {
    throw new Error(`Source changed: ${path}`)
  }
}

export default {
  ...base,
  test: {
    ...base.test,
    include: ['docs/audits/codex-hook-stdin-lifetime/probe.test.mjs'],
    maxWorkers: 1
  }
}
