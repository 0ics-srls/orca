import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || typeof global.gc !== 'function') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1 node --expose-gc')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const replacement = 'return flattenRetainedSlice(buildCheckLogTail(logText))'
const results = []
const bundles = {}
const parentChars = 2 * 1024 * 1024
const count = 8

function measure(excerpt, makeLog) {
  global.gc()
  const before = process.memoryUsage().heapUsed
  const retained = Array.from({ length: count }, (_, index) => excerpt(makeLog(index)))
  // Clear V8's independent legacy RegExp input reference before measuring our retained values.
  void /probe/.test('probe')
  global.gc()
  global.gc()
  const heapDelta = process.memoryUsage().heapUsed - before
  return {
    entries: retained.length,
    logicalChars: retained.reduce((total, text) => total + text.length, 0),
    logicalBytes: retained.reduce((total, text) => total + Buffer.byteLength(text), 0),
    heapDelta
  }
}

for (const fixed of [false, true]) {
  const result = await build({
    stdin: {
      contents: `
        export { sliceCheckLogTail } from './src/shared/check-job-log-tail-slice'
        export { gitLabJobTraceToLogExcerpt } from './src/shared/gitlab-job-log-excerpt'
      `,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: fixed
      ? []
      : [
          {
            name: 'baseline-without-excerpt-copy',
            setup(builder) {
              builder.onLoad({ filter: /check-job-log-tail-slice\.ts$/ }, async ({ path }) => {
                const source = await readFile(path, 'utf8')
                if (!source.includes(replacement)) {
                  throw new Error('The collector boundary changed; update the baseline transform')
                }
                return {
                  contents: source.replace(replacement, 'return buildCheckLogTail(logText)'),
                  loader: 'ts'
                }
              })
            }
          }
        ]
  })
  const bundle = result.outputFiles[0].text
  bundles[fixed ? 'after' : 'before'] = createHash('sha256').update(bundle).digest('hex')
  const { sliceCheckLogTail, gitLabJobTraceToLogExcerpt } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`
  )
  for (const [kind, makeLog, excerpt] of [
    ['github-long-line', (i) => `${i}:${'x'.repeat(parentChars)}`, sliceCheckLogTail],
    [
      'github-earlier-error',
      (i) => `error: ${i}:${'界'.repeat(parentChars)}\n${'recent\n'.repeat(100)}`,
      sliceCheckLogTail
    ],
    ['gitlab-long-line', (i) => `${i}:${'x'.repeat(parentChars)}`, gitLabJobTraceToLogExcerpt]
  ]) {
    results.push({ kind, fixed, ...measure(excerpt, makeLog) })
  }
}
console.log(
  JSON.stringify(
    { node: process.version, platform: process.platform, parentChars, count, bundles, results },
    null,
    2
  )
)
