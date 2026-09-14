import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { derivedGoldens } from './derived-goldens'
import { goldenRecording, type GoldenRecording } from './golden-recording'
import { RECORDER_DIRECTORY, recorderSha256 } from './recorder-digest'
import { readScenarios } from './scenario-input'
import type { RecordingScenario } from './recording-scenario'

const root = resolve(import.meta.dirname, '../../../..')
const manifest = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
).scenarios
const BASELINE = 'a'.repeat(40)
const EDITED_SCENARIO = 'b1'
const EDITED_SITE = 'files.searchPaths#1'
/**
 * Every golden derived from `b1`: its own, and its family's four matrix sites, which expand from it
 * as the family's base. The two other `legacy-inventory` scenarios and the interruption and
 * lifecycle goldens that expand from `inventory-lifecycle` are deliberately absent.
 */
const EDITED_GOLDENS = [
  'b1',
  'matrix-legacy-inventory-files.searchpaths-1',
  'matrix-legacy-inventory-files.searchpaths-2',
  'matrix-legacy-inventory-fresh-inventory',
  'matrix-legacy-inventory-old-inventory'
]
type Header = Omit<GoldenRecording, 'recording'>

const created: string[] = []
afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** The two files a root contributes to a header, plus the manifest the old digest also read. */
function stubRoot(recorder: string, scenarioFile?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rpc-header-'))
  created.push(directory)
  mkdirSync(join(directory, RECORDER_DIRECTORY), { recursive: true })
  writeFileSync(join(directory, RECORDER_DIRECTORY, 'runner.ts'), recorder)
  writeFileSync(join(directory, 'mobile/pnpm-lock.yaml'), 'lockfile: stub\n')
  if (scenarioFile !== undefined) {
    mkdirSync(join(directory, 'mobile/rpc-foundation'), { recursive: true })
    writeFileSync(join(directory, 'mobile/rpc-foundation/pilot-scenarios.json'), scenarioFile)
  }
  return directory
}

/** Every golden's header for one recorder revision and one manifest, both written to a stub root. */
function headers(recorder: string, scenarios: readonly RecordingScenario[]): Map<string, Header> {
  const stub = stubRoot(recorder, JSON.stringify({ baseline: BASELINE, scenarios }))
  return new Map(
    derivedGoldens(scenarios).map((golden) => {
      const { recording: _recording, ...header } = goldenRecording(
        stub,
        BASELINE,
        golden.scenarios(),
        { scenario: golden.id, checkpoints: [] }
      )
      return [golden.id, header]
    })
  )
}

function moved(before: Map<string, Header>, after: Map<string, Header>): string[] {
  return [...before]
    .filter(([id, header]) => JSON.stringify(after.get(id)) !== JSON.stringify(header))
    .map(([id]) => id)
    .sort()
}

/** A family no other golden consumes, with one reply the matrix can replay as its success. */
const ADDED_FAMILY: RecordingScenario = {
  id: 'digest-probe',
  operation: 'digest.probe',
  version: 1,
  family: 'digest-probe',
  sites: [],
  schedules: ['probe'],
  steps: [
    {
      complete: 'probe.read#1',
      params: { worktree: 'id:A' },
      reply: { ok: true, result: { probed: true } }
    },
    { checkpoint: 'settled' }
  ]
}

function editOneScenarioField(scenarios: readonly RecordingScenario[]): RecordingScenario[] {
  let edits = 0
  const edited = scenarios.map((scenario) =>
    scenario.id !== EDITED_SCENARIO
      ? scenario
      : {
          ...scenario,
          steps: scenario.steps.map((step) => {
            if (!('complete' in step) || step.complete !== EDITED_SITE) {
              return step
            }
            edits++
            return { ...step, params: { worktree: 'id:A', query: 'old', limit: 17 } }
          })
        }
  )
  if (edits !== 1) {
    throw new Error(`Expected one ${EDITED_SITE} step in ${EDITED_SCENARIO}, edited ${edits}`)
  }
  return edited
}

describe('golden header digests', () => {
  it('re-digests nothing when the manifest gains a family', () => {
    const before = headers('export const runner = 1', manifest)
    const after = headers('export const runner = 1', [...manifest, ADDED_FAMILY])
    expect(moved(before, after)).toEqual([])
    // The added family did derive goldens of its own: a pilot golden and one matrix site.
    expect(after.size).toBe(before.size + 2)
  })

  it('re-digests exactly the goldens derived from an edited scenario', () => {
    const before = headers('export const runner = 1', manifest)
    const after = headers('export const runner = 1', editOneScenarioField(manifest))
    expect(moved(before, after)).toEqual([...EDITED_GOLDENS].sort())
    for (const id of EDITED_GOLDENS) {
      expect(after.get(id)?.recorderSha256).toBe(before.get(id)?.recorderSha256)
      expect(after.get(id)?.scenarioSha256).not.toBe(before.get(id)?.scenarioSha256)
    }
  })

  it('re-digests every golden when a recorder file changes', () => {
    const before = headers('export const runner = 1', manifest)
    const after = headers('export const runner = 2', manifest)
    expect(moved(before, after)).toEqual([...before.keys()].sort())
    for (const [id, header] of before) {
      expect(after.get(id)?.recorderSha256).not.toBe(header.recorderSha256)
      expect(after.get(id)?.scenarioSha256).toBe(header.scenarioSha256)
    }
  })

  it('digests the recorder without reading the scenario manifest', () => {
    const one = stubRoot('export const runner = 1', JSON.stringify({ baseline: BASELINE }))
    const other = stubRoot('export const runner = 1', '{"scenarios":"edited"}')
    const absent = stubRoot('export const runner = 1')
    expect(recorderSha256(other)).toBe(recorderSha256(one))
    expect(recorderSha256(absent)).toBe(recorderSha256(one))
  })
})
