export const ASIA_POOL_CANARY_CELLS = new Set(['production-gce-c27'])

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`pool canary ${name} is invalid`)
  }
}

export function validateRelayPoolCanary(input) {
  if (!['apply', 'rollback'].includes(input.mode)) throw new Error('pool canary mode is invalid')
  if (!ASIA_POOL_CANARY_CELLS.has(input.cellId)) {
    throw new Error('pool canary requires the approved Asia serving cell')
  }
  integer(input.currentPool, 'predecessor pool')
  integer(input.targetPool, 'target pool')
  const expected = input.mode === 'apply' ? [10, 14] : [14, 10]
  if (input.currentPool !== expected[0]) {
    throw new Error(`pool canary ${input.mode} predecessor pool must be ${expected[0]}`)
  }
  if (input.targetPool !== expected[1]) {
    throw new Error(`pool canary ${input.mode} target pool must be ${expected[1]}`)
  }
  if (input.rollbackPool !== expected[0]) {
    throw new Error(`pool canary ${input.mode} rollback pool must be ${expected[0]}`)
  }
  if (!Number.isSafeInteger(input.cloudSqlBackends) || input.cloudSqlBackends < 1 || input.cloudSqlBackends > 250 ||
      !Number.isSafeInteger(input.cloudSqlWaitingBackends) || input.cloudSqlWaitingBackends < 0 ||
      input.cloudSqlWaitingBackends > 20 || input.cloudSqlWaitingBackends > input.cloudSqlBackends) {
    throw new Error('Cloud SQL headroom is insufficient for a pool canary')
  }
  if (input.rehomeEnabled !== false) throw new Error('regional rehome must remain disabled')
  integer(input.selectorGeneration, 'selector generation')
  integer(input.expectedSelectorGeneration, 'expected selector generation')
  if (input.selectorGeneration !== input.expectedSelectorGeneration) throw new Error('selector generation changed')
  integer(input.rehomeGeneration, 'rehome generation')
  integer(input.expectedRehomeGeneration, 'expected rehome generation')
  if (input.rehomeGeneration !== input.expectedRehomeGeneration) throw new Error('rehome generation changed')
  return { cellId: input.cellId, currentPool: input.currentPool, targetPool: input.targetPool,
    cloudSqlBackends: input.cloudSqlBackends, cloudSqlWaitingBackends: input.cloudSqlWaitingBackends }
}
