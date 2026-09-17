const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { applyPatch, parsePatch, reversePatch } = require('diff')

const root = path.resolve(__dirname, '../../..')
const read = (file) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
const sha = (value) => createHash('sha256').update(value).digest('hex')
const versions = JSON.parse(read(path.join(__dirname, 'source-versions.json')))

function verifySources() {
  assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
  for (const [file, expected] of Object.entries(versions.sourceHashes)) {
    assert.equal(sha(read(path.join(root, file))), expected, `Source drift: ${file}`)
  }
}

function readReportedTarget() {
  verifySources()
  const fixed = read(path.join(root, versions.targetPath))
  assert.equal(sha(fixed), versions.currentTargetSha256)
  const patches = parsePatch(read(path.join(__dirname, 'reported.patch')))
  assert.equal(patches.length, 1)
  assert.equal(patches[0].newFileName, `b/${versions.targetPath}`)
  const before = applyPatch(fixed, reversePatch(patches[0]))
  assert.notEqual(before, false)
  assert.equal(sha(before), versions.reportedTargetSha256)
  return before
}

module.exports = { verifySources, readReportedTarget }
