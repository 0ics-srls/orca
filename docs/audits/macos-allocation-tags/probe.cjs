const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const readline = require('node:readline')
const esbuild = require('esbuild')
const { createHash } = require('node:crypto')

async function main() {
  assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
  assert.equal(process.platform, 'darwin')
  const root = path.resolve(__dirname, '../../..')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-allocation-tags-'))
  try {
    const launcher = path.join(scratch, 'launcher.cjs')
    esbuild.buildSync({
      entryPoints: [path.join(root, 'src/shared/child-process/run-process.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: launcher
    })
    const { spawnProcess, runProcess } = require(launcher)
    const script = path.join(scratch, 'child.cjs')
    fs.writeFileSync(
      script,
      `
      const readline = require('node:readline');
      let retained;
      const report = (phase) => console.log(JSON.stringify({ phase, versions: process.versions, memory: process.memoryUsage(), heapLimit: require('node:v8').getHeapStatistics().heap_size_limit }));
      global.gc(); report('baseline');
      const input = readline.createInterface({ input: process.stdin });
      input.on('line', async mode => {
        if (mode === 'exit') process.exit(0);
        if (mode.endsWith('-reused')) {
          for (let pass = 0; pass < 3; pass++) {
            retained = Array.from({length:64}, () => mode.startsWith('buffer') ? Buffer.alloc(1024*1024, 1) : new Uint8Array(1024*1024).fill(1));
            retained = undefined; global.gc(); await new Promise(resolve => setImmediate(resolve)); global.gc();
          }
          mode = mode.replace('-reused', '');
        }
        if (mode === 'buffer') retained = Array.from({length:64}, () => Buffer.alloc(1024*1024, 1));
        else if (mode === 'typed') retained = Array.from({length:64}, () => new Uint8Array(1024*1024).fill(1));
        else if (mode === 'heap') retained = Array.from({length:8}, () => Array(1024*1024).fill(12345));
        else throw new Error('Unexpected mode');
        global.gc(); report(mode);
      });
      setTimeout(() => process.exit(2), 20000).unref();
    `
    )
    const electron = require(path.join(root, 'node_modules/electron'))
    const output = []
    for (const mode of ['heap', 'typed', 'buffer', 'typed-reused', 'buffer-reused']) {
      const child = spawnProcess({
        program: electron,
        args: ['--expose-gc', '--max-old-space-size=256', script],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ORCA_BACKGROUND_LAUNCH: '1' }
      })
      const exit = once(child, 'exit')
      const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]()
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-8192)
      })
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream.on('error', () => {})
      }
      const timeout = setTimeout(() => child.kill('SIGKILL'), 25000)
      try {
        const baseline = JSON.parse((await lines.next()).value)
        const inspect = async () => {
          const result = await runProcess({
            program: '/usr/bin/vmmap',
            args: ['-summary', String(child.pid)],
            timeoutMs: 5000,
            maxOutputBytes: 131072
          })
          assert.equal(result.code, 0, result.stderr)
          return result.stdout
        }
        const before = await inspect()
        child.stdin.write(`${mode}\n`)
        const allocated = JSON.parse((await lines.next()).value)
        const after = await inspect()
        child.stdin.end('exit\n')
        const termination = await exit
        assert.equal(termination[0], 0, stderr)
        const dirtyBytes = (text, label) => {
          const line = text
            .split('\n')
            .find((value) => value.startsWith(`${label} `) && !value.startsWith(`${label} (`))
          assert.ok(line, `Missing ${label}`)
          const value = line.slice(label.length).trim().split(/\s+/)[2]
          const match = /^(\d+(?:\.\d+)?)([KMGT]?)$/.exec(value)
          assert.ok(match, `Invalid dirty size ${value}`)
          return Math.round(Number(match[1]) * 1024 ** ' KMGT'.indexOf(match[2] || ' '))
        }
        const dirtyDeltaBytes = Object.fromEntries(
          ['Memory Tag 253', 'Memory Tag 255', 'VM_ALLOCATE'].map((label) => [
            label,
            dirtyBytes(after, label) - dirtyBytes(before, label)
          ])
        )
        output.push({
          mode,
          baseline,
          allocated,
          dirtyDeltaBytes,
          before,
          after,
          termination,
          probeSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
          launcherSha256: createHash('sha256')
            .update(fs.readFileSync(path.join(root, 'src/shared/child-process/run-process.ts')))
            .digest('hex')
        })
      } finally {
        clearTimeout(timeout)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
        await exit
      }
    }
    const serialized = `${JSON.stringify(output, null, 2)}\n`
    fs.writeFileSync(path.join(__dirname, 'results.json'), serialized)
    process.stdout.write(serialized)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
