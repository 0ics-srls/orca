import base from '../../../config/vitest.config.ts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative } from 'node:path'

const root = process.cwd()
const versions = JSON.parse(
  readFileSync(
    resolve(root, 'docs/audits/hidden-worktree-terminal-create/source-versions.json'),
    'utf8'
  )
)
const mode = process.env.ORCA_ISSUE18224_SOURCE ?? 'working'
if (!['working', 'main291b'].includes(mode)) {
  throw new Error(`Unsupported source mode: ${mode}`)
}
const hash = (source) => createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex')
for (const [path, expected] of Object.entries(versions.currentPaths)) {
  if (expected && hash(readFileSync(resolve(root, path), 'utf8')) !== expected) {
    throw new Error(`Changed source: ${path}`)
  }
}
const historical = new Map()
if (mode === 'main291b') {
  const pack = JSON.parse(
    readFileSync(
      resolve(root, 'docs/audits/hidden-worktree-terminal-create/main-sources.json'),
      'utf8'
    )
  )
  for (const row of versions.comparisons.filter((row) => row.name === mode && row.sha256)) {
    const source = pack[row.path]
    if (hash(source) !== row.sha256) {
      throw new Error(`Changed named source: ${row.path}`)
    }
    historical.set(row.path, source)
  }
}

export default {
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'issue18224-named-source-overlay',
      enforce: 'pre',
      load(id) {
        return historical.get(relative(root, id.split('?')[0]).replace(/\\/g, '/')) ?? null
      }
    }
  ],
  test: {
    ...base.test,
    include: ['docs/audits/hidden-worktree-terminal-create/probe.test.mjs'],
    environment: 'happy-dom',
    maxWorkers: 1
  }
}
