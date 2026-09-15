import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGolden } from './golden-recording'
import { OBSERVATION_FIELDS } from './golden-value-pool'
import type { Observation } from './recording-scenario'
import type { RecordedValue } from './recording-values'

const root = resolve(import.meta.dirname, '../../../..')
const directory =
  process.env.RPC_FOUNDATION_GOLDENS ?? resolve(root, 'mobile/rpc-foundation/goldens')

/** `captureValue`'s two refusals. Neither is ever product behaviour. */
const PROJECTION_REFUSALS = [
  'Unsupported observation',
  'Observation requires an explicit projection'
]

function refusalText(value: RecordedValue): boolean {
  if (typeof value === 'string') {
    return PROJECTION_REFUSALS.some((refusal) => value.includes(refusal))
  }
  if (Array.isArray(value)) {
    return value.some(refusalText)
  }
  return typeof value === 'object' && value !== null && Object.values(value).some(refusalText)
}

function detachedRejection(effects: RecordedValue): boolean {
  return (
    Array.isArray(effects) &&
    effects.some(
      (effect) =>
        typeof effect === 'object' &&
        effect !== null &&
        !Array.isArray(effect) &&
        effect.name === 'unhandled-rejection'
    )
  )
}

function failures(at: string, observation: Observation): string[] {
  const found: string[] = []
  if (detachedRejection(observation.effects)) {
    found.push(`${at}: unhandled-rejection effect`)
  }
  for (const field of OBSERVATION_FIELDS) {
    if (refusalText(observation[field])) {
      found.push(`${at}.${field}: recorder refused to project a value`)
    }
  }
  return found
}

/**
 * A recorder failure settles as data — a captured rejection, a `pending` action — so `--record`
 * writes it and the suite goes green over it. Two adapters shipped that way (#20667, and the
 * worktree catalog), and a revert plus a re-record would restore either one silently.
 */
describe('recorder failures never reach a golden', () => {
  it('records no detached rejection and no refused projection', () => {
    const ids = readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''))

    // Positive control: absence proves nothing unless both detectors fire on the shapes they name.
    const seeded: Observation = {
      sender: [],
      payloads: [],
      settlements: { fetch: { status: 'rejected' } },
      state: { fetched: 'Unsupported observation: function' },
      effects: [{ name: 'unhandled-rejection', value: {} }]
    }
    expect(failures('seeded', seeded)).toEqual([
      'seeded: unhandled-rejection effect',
      'seeded.state: recorder refused to project a value'
    ])

    let checkpoints = 0
    const found = ids.flatMap((id) =>
      readGolden(directory, id).recording.checkpoints.flatMap((checkpoint) => {
        checkpoints++
        return failures(`${id}/${checkpoint.id}`, checkpoint.observation)
      })
    )
    expect(found).toEqual([])
    expect(ids.length).toBeGreaterThan(0)
    expect(checkpoints).toBeGreaterThan(ids.length)
  })
})
