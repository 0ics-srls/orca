import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import headless from '@xterm/headless'
import rendered from '@xterm/xterm'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' || typeof global.gc !== 'function') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1 node --expose-gc')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const built = await build({
  entryPoints: [resolve(root, 'src/shared/terminal-osc-link-retirement.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const bundle = built.outputFiles[0].text
const { createTerminalOscLinkRetirement } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`
)
const results = []
for (const [kind, { Terminal }] of [
  ['headless', headless],
  ['renderer', rendered]
]) {
  for (const mode of ['overwrite', 'erase-line', 'alternate']) {
    for (const fixed of [false, true]) {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 5000,
        allowProposedApi: true,
        logLevel: 'off'
      })
      const retirement = createTerminalOscLinkRetirement(terminal)
      const core = terminal._core
      if (mode === 'alternate') {
        core.writeSync('\x1b[?1049h')
      }
      global.gc()
      const before = process.memoryUsage().heapUsed
      const samples = []
      try {
        for (let index = 1; index <= 10000; index++) {
          core.writeSync(
            `${mode === 'erase-line' ? '\x1b[2K' : ''}\r\x1b]8;;https://example.test/path\x1b\\x\x1b]8;;\x1b\\`
          )
          if (fixed) {
            retirement()
          }
          if (index % 2500 === 0) {
            global.gc()
            samples.push({
              updates: index,
              links: core._oscLinkService._dataByLinkId.size,
              markers: terminal.markers.length,
              rows: terminal.buffer.active.length,
              retainedHeapDelta: process.memoryUsage().heapUsed - before
            })
          }
        }
        results.push({ kind, mode, fixed, samples })
      } finally {
        terminal.dispose()
      }
    }
  }
}
const terminal = new headless.Terminal({
  cols: 160,
  rows: 24,
  scrollback: 5000,
  allowProposedApi: true,
  logLevel: 'off'
})
let sweepCost
try {
  terminal._core.writeSync('x\r\n'.repeat(6000))
  terminal._core.writeSync('\r\x1b]8;;https://example.test/path\x1b\\x\x1b]8;;\x1b\\'.repeat(1024))
  const retirement = createTerminalOscLinkRetirement(terminal)
  const started = performance.now()
  const removed = retirement()
  sweepCost = {
    rows: terminal.buffer.normal.length,
    columns: terminal.cols,
    removed,
    milliseconds: performance.now() - started
  }
} finally {
  terminal.dispose()
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      bundleSha256: createHash('sha256').update(bundle).digest('hex'),
      results,
      sweepCost
    },
    null,
    2
  )
)
