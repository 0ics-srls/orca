import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { overlayRelayLiveCellImages } from './relay-live-cell-image-overlay.mjs'

const repository = 'us-central1-docker.pkg.dev/onorca-cloud/orca-cloud/relay'
const committed = `${repository}@sha256:${'a'.repeat(64)}`
const served = `${repository}@sha256:${'b'.repeat(64)}`
const template = readFileSync(
  new URL('../../infra/terraform/relay-gce-startup.sh.tftpl', import.meta.url),
  'utf8'
)

// Renders only the two lines the overlay reads, from the real template, so a template edit fails here.
function startupScript(image) {
  return template
    .replaceAll('${trimprefix(regex("@sha256:[a-f0-9]{64}$", relay_image), "@")}', image.split('@')[1])
    .replaceAll('${relay_image}', image)
    .replaceAll('${cloud_sql_proxy_image}', `gcr.io/cloud-sql-connectors/cloud-sql-proxy@sha256:${'c'.repeat(64)}`)
}

const cell = (image) => ({ hostname: 'x', region: 'asia-east2', zone: 'asia-east2-a', image, connection_hard_cap: 3000 })
const committedCells = {
  'production-gce-c1': cell(committed),
  'production-gce-c27': cell(committed),
  'production-gce-c30': cell(committed)
}
const live = [
  { index: 'production-gce-c1', metadata_startup_script: startupScript(committed) },
  { index: 'production-gce-c27', metadata_startup_script: startupScript(served) }
]

test('plans every non-target cell at the image its live template serves', () => {
  const overlay = overlayRelayLiveCellImages({
    committedCells, liveTemplates: live, targetCellIds: ['production-gce-c30']
  })
  assert.deepEqual(overlay, {
    relay_gce_cells: {
      'production-gce-c1': cell(committed),
      'production-gce-c27': cell(served),
      'production-gce-c30': cell(committed)
    }
  })
})

test('leaves a target cell at its committed image even once it has a live template', () => {
  const overlay = overlayRelayLiveCellImages({
    committedCells,
    liveTemplates: [...live, { index: 'production-gce-c30', metadata_startup_script: startupScript(served) }],
    targetCellIds: ['production-gce-c30']
  })
  assert.equal(overlay.relay_gce_cells['production-gce-c30'].image, committed)
})

test('refuses a non-target cell that has no live template', () => {
  assert.throws(() => overlayRelayLiveCellImages({
    committedCells, liveTemplates: live.slice(1), targetCellIds: ['production-gce-c30']
  }), /production-gce-c1 is not a target and has no live template/)
})

test('refuses a live template without one pinned Relay image', () => {
  const digestMismatch = startupScript(served)
    .replace(`%s\\n' 'sha256:${'b'.repeat(64)}'`, `%s\\n' 'sha256:${'d'.repeat(64)}'`)
  for (const script of [
    digestMismatch,
    startupScript(served).replace(`docker pull '${served}'`, ''),
    `${startupScript(served)}\ndocker pull '${committed}'`,
    startupScript(`${repository}:latest`)
  ]) {
    assert.throws(() => overlayRelayLiveCellImages({
      committedCells,
      liveTemplates: [live[0], { index: 'production-gce-c27', metadata_startup_script: script }],
      targetCellIds: ['production-gce-c30']
    }), /production-gce-c27 live template has no single pinned Relay image/)
  }
})

test('refuses duplicate live templates and an undeclared target', () => {
  assert.throws(() => overlayRelayLiveCellImages({
    committedCells, liveTemplates: [...live, live[1]], targetCellIds: ['production-gce-c30']
  }), /more than one live template/)
  assert.throws(() => overlayRelayLiveCellImages({
    committedCells, liveTemplates: live, targetCellIds: ['production-gce-c31']
  }), /production-gce-c31 is not a committed Relay cell/)
})
