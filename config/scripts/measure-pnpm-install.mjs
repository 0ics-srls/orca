import { lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Logical file bytes exclude symlinks; shared-store hardlinks/APFS clones are not unique disk use.
function measureDirectory(directory) {
  let bytes = 0
  let files = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = measureDirectory(path)
      bytes += nested.bytes
      files += nested.files
    } else if (entry.isFile()) {
      bytes += lstatSync(path).size
      files += 1
    }
  }
  return { bytes, files }
}

const store = resolve(process.argv[2] ?? 'node_modules', '.pnpm')
const families = {
  canvas: ['@napi-rs+canvas-'],
  sherpa: ['sherpa-onnx-'],
  oxlint: ['@oxlint+', '@oxlint-tsgolint+'],
  swc: ['@swc+core-'],
  typescript: ['@typescript+']
}
const result = { packages: 0, files: 0, bytes: 0, families: {} }
for (const entry of readdirSync(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') {
    continue
  }
  const size = measureDirectory(join(store, entry.name))
  result.packages += 1
  result.files += size.files
  result.bytes += size.bytes
  for (const [family, prefixes] of Object.entries(families)) {
    if (prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      result.families[family] = (result.families[family] ?? 0) + size.bytes
    }
  }
}
console.log(JSON.stringify(result, null, 2))
