import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterSourceByOperation } from './adapter-digest'
import { MOUNTED_OPERATION_MODULES } from './adapters/mounted-operation-modules'
import { operationModuleLoader } from './operation-module-loader'
import { pilotMountAdapters } from './pilot-mount-adapters'
import { ADAPTER_DIRECTORY } from './recorder-digest'
import { readScenarios } from './scenario-input'

const root = resolve(import.meta.dirname, '../../../..')
const manifest = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
).scenarios
const directory = join(root, ADAPTER_DIRECTORY)
/** The register is the seam's own index, not an adapter: no golden is recorded through it. */
const REGISTER = 'mounted-operation-modules.ts'
const sources = MOUNTED_OPERATION_MODULES.map((module) => module.source)

function read(source: string): string {
  return readFileSync(join(directory, source), 'utf8')
}

/**
 * `recorderSha256` covers the engine and `adapterSha256` covers one module per golden, so a file on
 * the wrong side of this directory is pinned by the wrong thing — an engine file here escapes every
 * golden, and an adapter outside re-digests all of them. Both fail here on the move instead.
 */
describe('the engine/adapter seam', () => {
  it('registers every file in the adapter directory', () => {
    const present = readdirSync(directory).filter((file) => file !== REGISTER)
    expect(present.sort()).toEqual([...sources].sort())
  })

  it('pairs each registered module with the file that declares it', () => {
    expect(new Set(sources).size).toBe(sources.length)
    const unpaired = MOUNTED_OPERATION_MODULES.filter(
      ({ source, mounts }) => !read(source).includes(`export function ${mounts.name}(`)
    ).map(({ source, mounts }) => `${mounts.name} is not declared in ${source}`)
    expect(unpaired).toEqual([])
  })

  // An adapter reaching sideways would leave a golden pinned to one module and driven by two.
  it('leaves the seam for every import an adapter module makes', () => {
    const inward = sources.flatMap((source) =>
      [...read(source).matchAll(/(?:from|import\()\s*'(\.[^']*)'/g)]
        .filter((match) => !match[1]!.startsWith('../'))
        .map((match) => `${source} imports ${match[1]}`)
    )
    expect(inward).toEqual([])
  })

  it('mounts nothing outside a registered module', () => {
    const modules = operationModuleLoader(root)
    const registered = MOUNTED_OPERATION_MODULES.flatMap((module) =>
      Object.keys(module.mounts(modules, {}))
    )
    expect(Object.keys(pilotMountAdapters(root).adapters).sort()).toEqual([...registered].sort())
  })

  it('attributes every recorded operation to a registered module', () => {
    const owners = adapterSourceByOperation(root)
    const orphans = [...new Set(manifest.map((scenario) => scenario.operation))]
      .filter((operation) => !owners.has(operation))
      .sort()
    expect(orphans).toEqual([])
  })
})
