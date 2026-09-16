const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { transformSync } = require('esbuild')
const { applyPatch } = require('diff')

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1')
}
const { createHash } = require('node:crypto')
const repositoryRoot = path.resolve(__dirname, '../../..')
const baselineBundle = process.env.ORCA_AUDIT_HEADLESS_BASELINE
  ? path.resolve(process.env.ORCA_AUDIT_HEADLESS_BASELINE)
  : require.resolve('@xterm/headless')
const baselineBytes = fs.readFileSync(baselineBundle)
const map = JSON.parse(fs.readFileSync(`${baselineBundle}.map`, 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const sources = new Map(
  map.sources.map((source, index) => [source.replace(/^.*?\/src\//, ''), map.sourcesContent[index]])
)
const linePath = 'common/buffer/BufferLine.ts'
const patch = fs.readFileSync(
  path.join(repositoryRoot, 'config/patches/xterm-src/@xterm__headless@6.1.0-beta.302.src.patch'),
  'utf8'
)
const patched = applyPatch(sources.get(linePath), patch)
assert.equal(
  typeof patched,
  'string',
  'Baseline source is already patched or differs; set ORCA_AUDIT_HEADLESS_BASELINE to the pristine pinned headless bundle'
)

function modules(variant) {
  const cache = new Map()
  function load(name) {
    name = `${name.replace(/\.ts$/, '')}.ts`
    if (cache.has(name)) {
      return cache.get(name).exports
    }
    let source = sources.get(name)
    if (name === linePath) {
      if (variant === 'patched') {
        source = patched
      }
      source += '\nexport function auditScratchChars() { return $workCell.combinedData.length; }\n'
    }
    assert.equal(typeof source, 'string', `missing mapped source: ${name}`)
    const module = { exports: {} }
    cache.set(name, module)
    const output = transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2022',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } }
    }).code
    new Function('require', 'module', 'exports', output)(
      (specifier) =>
        load(
          specifier.startsWith('.')
            ? path.posix.join(path.posix.dirname(name), specifier)
            : specifier
        ),
      module,
      module.exports
    )
    return module.exports
  }
  return load
}

function fixture(variant, cols = 16) {
  const load = modules(variant)
  const exports = load(linePath)
  const blank = load('common/buffer/CellData').CellData.fromCharData([0, '', 1, 0])
  return { ...exports, blank, line: new exports.BufferLine(cols, blank) }
}

function semanticCheck(variant) {
  const A = fixture('baseline')
  const B = fixture(variant)
  const a = A.line
  const b = B.line
  let state = 72651
  const rand = (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % n
  }
  for (let step = 0; step < 25000; step++) {
    const p = rand(a.length)
    const n = 1 + rand(a.length - p)
    const op = rand(10)
    if (op === 0) {
      const s = ['x', 'e\u0301', '界\u0301', ''][rand(4)]
      const width = s.startsWith('界') ? 2 : 1
      a.set(p, [step, s, width, 0])
      b.set(p, [step, s, width, 0])
    } else if (op === 1) {
      const codepoint = 65 + rand(26)
      a.setCellFromCodepoint(p, codepoint, 1, A.blank)
      b.setCellFromCodepoint(p, codepoint, 1, B.blank)
    } else if (op === 2) {
      a.addCodepointToCell(p, 769, 0)
      b.addCodepointToCell(p, 769, 0)
    } else if (op === 3) {
      a.insertCells(p, n, A.blank)
      b.insertCells(p, n, B.blank)
    } else if (op === 4) {
      a.deleteCells(p, n, A.blank)
      b.deleteCells(p, n, B.blank)
    } else if (op === 5) {
      a.replaceCells(p, p + n, A.blank)
      b.replaceCells(p, p + n, B.blank)
    } else if (op === 6) {
      const length = 2 + rand(30)
      a.resize(length, A.blank)
      b.resize(length, B.blank)
    } else if (op === 7) {
      const dest = rand(a.length)
      const length = Math.min(n, a.length - dest)
      a.copyCellsFrom(a, p, dest, length, dest > p)
      b.copyCellsFrom(b, p, dest, length, dest > p)
    } else if (op === 8) {
      a.fill(A.blank)
      b.fill(B.blank)
    } else {
      a.copyFrom(a.clone())
      b.copyFrom(b.clone())
    }
    assert.equal(b.translateToString(false), a.translateToString(false), `translation ${step}`)
    for (let index = 0; index < a.length; index++) {
      assert.deepEqual(b.get(index), a.get(index), `cell ${step}:${index}`)
    }
    for (const key of Object.keys(b._combined)) {
      assert.ok(b.isCombined(Number(key)))
    }
  }
  return { variant, matchedMutations: 25000 }
}

function retentionCheck(variant) {
  const result = { variant }
  for (const shift of ['delete', 'insert']) {
    const f = fixture(variant, 4)
    f.line.set(shift === 'delete' ? 3 : 0, [0, `a${'\u0301'.repeat(100000)}`, 1, 769])
    if (shift === 'delete') {
      f.line.deleteCells(0, 1, f.blank)
    } else {
      f.line.insertCells(0, 1, f.blank)
    }
    f.line.fill(f.blank)
    assert.equal(f.line.translateToString(true), '')
    result[`${shift}ScratchCharsAfterErase`] = f.auditScratchChars()
  }
  const f = fixture(variant, 4)
  f.line.set(0, [0, `a${'\u0301'.repeat(100000)}`, 1, 769])
  f.line.translateToString(true)
  f.line.setCellFromCodepoint(0, 90, 1, f.blank)
  result.invalidCacheChars = f.line._cache.length
  result.erasedCombinedChars = f.line._combined[0]?.length ?? 0
  if (variant !== 'baseline') {
    assert.equal(result.deleteScratchCharsAfterErase, 0)
    assert.equal(result.insertScratchCharsAfterErase, 0)
    assert.equal(result.invalidCacheChars, 0)
    assert.equal(result.erasedCombinedChars, 0)
  }
  return result
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      baselineBundleSha256: hash(baselineBytes),
      baselineBufferLineSha256: hash(sources.get(linePath)),
      patchedBufferLineSha256: hash(patched),
      semanticChecks: [semanticCheck('patched')],
      retentionChecks: ['baseline', 'patched'].map(retentionCheck),
      limits:
        'Actual mapped BufferLine source with a test-only scratch inspection export; patch applied in memory. All visible cell/translation comparisons use the unmodified baseline.'
    },
    null,
    2
  )
)
