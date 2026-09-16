const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const ts = require('typescript-api')
const { buildSync } = require('esbuild')

async function main() {
  const root = resolve(__dirname, '../../..')
  const scratch = mkdtempSync(join(tmpdir(), 'orca-collection-loop-scan-'))
  const launcher = join(scratch, 'run-process.cjs')
  try {
    buildSync({
      entryPoints: [join(root, 'src/shared/child-process/run-process.ts')],
      outfile: launcher,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent'
    })
    const { runProcess } = require(launcher)
    const listed = await runProcess({
      program: 'git',
      args: ['ls-files', '-z', 'src/main', 'src/shared'],
      cwd: root,
      timeoutMs: 10000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    if (listed.code !== 0 || listed.timedOut) {
      throw new Error('Tracked source listing failed')
    }
    const paths = listed.stdout
      .split('\0')
      .filter(
        (path) =>
          path.endsWith('.ts') && !/\.(?:test|spec)\.ts$|fixture|harness|generated/.test(path)
      )
    let loops = 0
    const hits = []
    for (const path of paths) {
      const content = readFileSync(join(root, path), 'utf8')
      const sourceHash = createHash('sha256').update(content).digest('hex')
      const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
      const text = (node) => node.getText(source)
      const visit = (node) => {
        if (ts.isForOfStatement(node)) {
          loops += 1
          let receiver = node.expression
          if (
            ts.isCallExpression(receiver) &&
            ts.isPropertyAccessExpression(receiver.expression) &&
            ['values', 'keys', 'entries'].includes(receiver.expression.name.text)
          ) {
            receiver = receiver.expression.expression
          }
          const iterated = text(receiver)
          const checkMutation = (candidate) => {
            if (
              ts.isCallExpression(candidate) &&
              ts.isPropertyAccessExpression(candidate.expression) &&
              text(candidate.expression.expression) === iterated &&
              ['set', 'add', 'push', 'unshift'].includes(candidate.expression.name.text)
            ) {
              hits.push({
                path,
                sourceHash,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                iterated,
                call: text(candidate)
              })
            }
            ts.forEachChild(candidate, checkMutation)
          }
          checkMutation(node.statement)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    const output = {
      scope:
        'Tracked main/shared .ts files, excluding test/spec, fixture, harness and generated names. Exact receiver spelling only; no alias or interprocedural analysis.',
      parserVersion: ts.version,
      files: paths.length,
      loops,
      hits
    }
    const encoded = `${JSON.stringify(output, null, 2)}\n`
    if (process.argv[2]) {
      writeFileSync(process.argv[2], encoded)
    } else {
      process.stdout.write(encoded)
    }
  } finally {
    delete require.cache[launcher]
    rmSync(scratch, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
