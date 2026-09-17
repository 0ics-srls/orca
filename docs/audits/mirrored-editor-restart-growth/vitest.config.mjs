import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import base from '../../../config/vitest.config.ts'

const { loadSources } = createRequire(import.meta.url)('./sources.cjs')
const loaded = loadSources()

export default {
  ...base,
  test: {
    ...base.test,
    include: ['docs/audits/mirrored-editor-restart-growth/lifecycle.test.mjs'],
    maxWorkers: 1
  },
  plugins: [
    {
      name: 'reported-editor-hydration-projection',
      enforce: 'pre',
      transform(_code, id) {
        const source = loaded.sources.get(resolve(id.split('?')[0]))
        return source === undefined ? undefined : { code: source, map: null }
      }
    }
  ]
}
