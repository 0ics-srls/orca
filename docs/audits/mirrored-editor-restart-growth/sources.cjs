const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { resolve } = require('node:path')

const canonicalLf = (text) => text.replaceAll('\r\n', '\n')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const readText = (filename) => readFileSync(filename, 'utf8')
const root = resolve(__dirname, '../../..')

function loadSources({
  variant = process.env.ORCA_10859_VARIANT ?? 'current',
  read = readText
} = {}) {
  assert.ok(variant === 'current' || variant === 'reported-hydration')
  const readCanonical = (filename) => canonicalLf(read(filename))
  const versions = JSON.parse(readCanonical(resolve(__dirname, 'source-versions.json')))
  const projection = JSON.parse(readCanonical(resolve(__dirname, 'reported-projection.json')))
  const hashes = {}
  for (const source of versions.sources) {
    const text = readCanonical(resolve(root, source.path))
    const hash = sha256(text)
    assert.equal(hash, source.currentSha256, `Selected source drift: ${source.path}`)
    hashes[source.path] = hash
  }
  const fixtures = {}
  const fixtureHashes = {}
  for (const [name, expected] of Object.entries(projection.fixtureSha256)) {
    const text = readCanonical(resolve(__dirname, name))
    assert.equal(sha256(text), expected, `Historical fixture drift: ${name}`)
    fixtures[name] = text
    fixtureHashes[name] = expected
  }
  const method = fixtures['reported-hydration-method.txt'].replace(/\n$/, '')
  assert.equal(sha256(method), projection.verbatimMethodSha256)
  assert.ok(fixtures['reported-hydration-module.txt'].includes(method))
  const sources = new Map()
  if (variant === 'reported-hydration') {
    sources.set(
      resolve(root, 'src/renderer/src/store/slices/editor/actions/hydrate-editor-session.ts'),
      fixtures['reported-hydration-module.txt']
    )
    sources.set(
      resolve(root, 'src/renderer/src/store/slices/editor/file-ids/hydrated-editor-file-ids.ts'),
      fixtures['reported-hydration-ids.txt']
    )
  }
  return { root, sources, hashes, fixtureHashes, variant }
}

module.exports = { loadSources }
