import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateRelayPoolCanary } from './validate-relay-pool-canary.mjs'

const base = { mode: 'apply', cellId: 'production-gce-c27', currentPool: 10, targetPool: 14,
  rollbackPool: 10,
  cloudSqlBackends: 130, cloudSqlWaitingBackends: 0, rehomeEnabled: false,
  selectorGeneration: 230, expectedSelectorGeneration: 230, rehomeGeneration: 14, expectedRehomeGeneration: 14 }

test('accepts only the bounded c27 10 to 14 canary', () => assert.equal(validateRelayPoolCanary(base).targetPool, 14))

for (const [name, change, message] of [
  ['rejects non-Asia cells', { cellId: 'production-gce-c26' }, /approved Asia/],
  ['rejects wrong predecessor', { currentPool: 9 }, /predecessor/],
  ['rejects wrong target', { targetPool: 15 }, /target/],
  ['rejects wrong rollback target', { rollbackPool: 14 }, /rollback pool/],
  ['rejects backend headroom', { cloudSqlBackends: 251 }, /headroom/],
  ['rejects waiting headroom', { cloudSqlWaitingBackends: 21 }, /headroom/],
  ['rejects impossible waiting headroom', { cloudSqlBackends: 10, cloudSqlWaitingBackends: 11 }, /headroom/],
  ['rejects missing metrics', { cloudSqlBackends: undefined }, /headroom/],
  ['rejects enabled rehome', { rehomeEnabled: true }, /disabled/],
  ['rejects selector drift', { selectorGeneration: 231 }, /selector/],
  ['rejects rehome generation drift', { rehomeGeneration: 15 }, /rehome generation/]
]) test(name, () => assert.throws(() => validateRelayPoolCanary({ ...base, ...change }), message))

test('accepts and validates the exact rollback transition', () => {
  const rollback = { ...base, mode: 'rollback', currentPool: 14, targetPool: 10, rollbackPool: 14 }
  assert.equal(validateRelayPoolCanary(rollback).targetPool, 10)
  assert.throws(() => validateRelayPoolCanary({ ...rollback, currentPool: 10 }), /predecessor/)
})
