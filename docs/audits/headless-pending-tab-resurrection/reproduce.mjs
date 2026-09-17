import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyPatch, parsePatch, reversePatch } from 'diff'
import { build } from 'esbuild'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const artifact = import.meta.dirname
const manifest = JSON.parse(await readFile(join(artifact, 'source-manifest.json'), 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const current = {}
for (const [path, expected] of Object.entries(manifest.sources)) {
  current[path] = (await readFile(resolve(root, path), 'utf8')).replaceAll('\r\n', '\n')
  if (hash(current[path]) !== expected.working) {
    throw new Error(`Source changed; review the diagnostic: ${path}`)
  }
}
const artifactHashes = {}
for (const path of [
  'fixture.test.mjs',
  'reproduce.mjs',
  'source-manifest.json',
  'reported.patch',
  'main.patch'
]) {
  artifactHashes[path] = hash(await readFile(join(artifact, path)))
}
const scratch = await mkdtemp(join(tmpdir(), 'orca-headless-pending-tab-'))
const require = createRequire(import.meta.url)
let runnerModuleId
try {
  const runnerPath = join(scratch, 'run-process.cjs')
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'src/shared/child-process/run-process.ts')],
    outfile: runnerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
  runnerModuleId = require.resolve(runnerPath)
  const { runProcess } = require(runnerModuleId)
  const phases = {}
  for (const phase of ['working', 'main', 'reported']) {
    const overlay = {}
    if (phase !== 'working') {
      const patches = parsePatch(
        (await readFile(join(artifact, `${phase}.patch`), 'utf8')).replaceAll('\r\n', '\n')
      )
      const byPath = new Map(patches.map((patch) => [patch.newFileName.replace(/^b\//, ''), patch]))
      for (const [path, expected] of Object.entries(manifest.sources)) {
        let source = current[path]
        const patch = byPath.get(path)
        if (patch) {
          source = applyPatch(source, reversePatch(patch))
        }
        if (source === false || (expected[phase] !== null && hash(source) !== expected[phase])) {
          throw new Error(`Historical source mismatch: ${phase}:${path}`)
        }
        overlay[resolve(root, path).replaceAll('\\', '/')] =
          expected[phase] === null ? null : source
      }
    }
    const config = join(scratch, `${phase}.config.mjs`)
    const configImport = JSON.stringify(
      pathToFileURL(resolve(root, 'config/vitest.config.ts')).href
    )
    await writeFile(
      config,
      `import base from ${configImport};
const overlay = ${JSON.stringify(overlay)};
export default {...base, test: {...base.test, include: ['docs/audits/headless-pending-tab-resurrection/fixture.test.mjs']}, plugins: [{
  name: 'headless-pending-tab-${phase}', enforce: 'pre',
  transform(_code, id) {
    const key = id.replaceAll('\\\\', '/').split('?')[0];
    if (!Object.hasOwn(overlay, key)) return null;
    if (overlay[key] === null) throw new Error('Module absent in ${phase}: ' + key);
    return {code: overlay[key], map: null};
  }
}]};\n`
    )
    const report = join(scratch, `${phase}.json`)
    const result = await runProcess({
      program: process.execPath,
      args: [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        config,
        '--reporter=json',
        `--outputFile=${report}`
      ],
      cwd: root,
      env: process.env,
      timeoutMs: 90_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    let parsed
    try {
      parsed = JSON.parse(await readFile(report, 'utf8'))
    } catch (error) {
      throw new Error(`${phase} runner failed: ${result.stderr || result.stdout}`, { cause: error })
    }
    phases[phase] = {
      exitCode: result.code,
      timedOut: result.timedOut,
      passed: parsed.numPassedTests,
      failed: parsed.numFailedTests,
      cases: parsed.testResults.flatMap((suite) =>
        suite.assertionResults.map((test) => ({
          name: test.fullName,
          status: test.status,
          ...(test.status === 'failed' ? { failures: test.failureMessages } : {})
        }))
      )
    }
    console.log(`${phase}: ${phases[phase].passed} passed, ${phases[phase].failed} failed`)
  }
  const passed = Object.values(phases).every(
    (phase) => phase.exitCode === 0 && !phase.timedOut && phase.passed === 12 && phase.failed === 0
  )
  const result = {
    comparison:
      'Actual runtime/controller/Store; historical overlays cover the 31 manifest paths with other dependencies current',
    runtime: process.version,
    commits: manifest.commits,
    sourceHashes: manifest.sources,
    artifactHashes,
    phases,
    passed
  }
  await writeFile(
    process.argv[2] ? resolve(process.argv[2]) : join(artifact, 'results.json'),
    `${JSON.stringify(result, null, 2)}\n`
  )
  if (!passed) {
    process.exitCode = 1
  }
} finally {
  if (runnerModuleId) {
    delete require.cache[runnerModuleId]
  }
  await rm(scratch, { recursive: true, force: true })
}
