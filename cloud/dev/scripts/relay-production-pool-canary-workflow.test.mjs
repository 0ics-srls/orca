import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dispatch = readFileSync(new URL('../../../.github/workflows/cloud-deploy-relay-production-same-cap.yml', import.meta.url), 'utf8')
const job = readFileSync(new URL('../../../.github/workflows/cloud-deploy-relay-production-same-cap-job.yml', import.meta.url), 'utf8')

test('pool canary is c27-only and has explicit pool/headroom inputs', () => {
  assert.match(dispatch, /pool-canary-apply/)
  assert.match(dispatch, /pool-canary-rollback/)
  assert.match(dispatch, /pool canary is restricted to production-gce-c27/)
  for (const marker of ['predecessor-pool', 'target-pool', 'rollback-pool', 'cloud-sql-backends', 'cloud-sql-waiting-backends']) {
    assert.match(dispatch, new RegExp(marker))
    assert.match(job, new RegExp(marker))
  }
})

test('post-change observation fails closed before admission restore', () => {
  const observation = job.indexOf('Enforce bounded c27 pool-canary observation')
  const restore = job.indexOf('Restore only the verified selected cell to general admission')
  assert.ok(observation >= 0 && observation < restore)
  assert.match(job, /validate-relay-pool-canary-observation\.mjs/)
  assert.match(job, /gcloud logging read/)
  assert.match(job, /status=RUNNING/)
  assert.match(job, /ENTRY_COUNT.*-lt 10000/)
  assert.match(job, /date -u -v-120S/)
  assert.match(job, /collect-relay-pool-canary-observation\.mjs/)
  assert.match(job, /verify-relay-pool-cloud-sql-headroom\.mjs/)
  assert.match(job, /\$\{CLOUD_SQL_WAITING_BACKENDS\}/)
  assert.match(readFileSync(new URL('./relay-asia-cloud-sql-metrics.mjs', import.meta.url), 'utf8'), /backends_in_wait/)
  assert.match(job, /pool-canary-rollback-required/)
  assert.match(job, /relay-pool-canary-rollback-\$\{\{ github\.run_id \}\}/)
})

test('rollback validates the static Terraform pool against the rollback target', () => {
  const poolCheck = job.indexOf('CONFIGURED_POOL=')
  const rollbackBranch = job.indexOf('DEPLOY_MODE}" = pool-canary-rollback', poolCheck)
  assert.ok(poolCheck >= 0 && rollbackBranch > poolCheck)
  assert.match(job.slice(rollbackBranch, rollbackBranch + 300), /ROLLBACK_POOL/)
})
