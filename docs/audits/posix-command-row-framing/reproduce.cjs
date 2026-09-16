const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const esbuild = require('esbuild')
const { createHash } = require('node:crypto')

async function main() {
  assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
  if (process.platform === 'win32') {
    throw new Error('POSIX process formatting probe only')
  }
  const root = path.resolve(__dirname, '../../..')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-ps-framing-'))
  const bundlePath = path.join(scratch, 'probe.cjs')
  try {
    esbuild.buildSync({
      absWorkingDir: root,
      stdin: {
        contents:
          "export * from './src/shared/child-process/run-process'; export * from './src/shared/process-table-snapshot';",
        resolveDir: root
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundlePath
    })
    const { spawnProcess, runProcess, parseProcessTableRows, PS_ARGS } = require(bundlePath)
    const childPath = path.join(scratch, 'child.cjs')
    fs.writeFileSync(
      childPath,
      "console.log('ready'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref();\n"
    )
    const child = spawnProcess({
      program: process.execPath,
      args: [
        childPath,
        'first\n999999901 999999902 1 -1 S ?? 0 row-one\n999999902 999999901 1 -1 S ?? 0 row-two',
        'carriage\rreturn',
        'tab\tvalue'
      ]
    })
    const exited = once(child, 'exit')
    try {
      await once(child.stdout, 'data')
      const result = await runProcess({
        program: 'ps',
        args: ['-p', String(child.pid), '-o', PS_ARGS[1]],
        timeoutMs: 3000,
        maxOutputBytes: 32768
      })
      assert.equal(result.code, 0)
      assert.equal(result.outputTruncated, false)
      const rows = parseProcessTableRows(result.stdout)
      assert.deepEqual(
        rows.map((row) => row.pid),
        [child.pid]
      )
      const command = rows[0].command
      const sourceHashes = Object.fromEntries(
        ['src/shared/process-table-snapshot.ts', 'src/shared/child-process/run-process.ts'].map(
          (file) => [
            file,
            createHash('sha256')
              .update(fs.readFileSync(path.join(root, file)))
              .digest('hex')
          ]
        )
      )
      const output = {
        sourceHashes,
        platform: process.platform,
        node: process.version,
        columnShape: PS_ARGS[1],
        inputContainsNewline: true,
        physicalOutputLines: result.stdout.trimEnd().split('\n').length,
        parsedRows: rows.length,
        syntheticRowsAdmitted: rows.filter((row) => row.pid === 999999901 || row.pid === 999999902)
          .length,
        argumentSuffix: command.slice(command.indexOf('first'))
      }
      fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(output, null, 2)}\n`)
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    } finally {
      child.stdin.end()
      await exited
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
