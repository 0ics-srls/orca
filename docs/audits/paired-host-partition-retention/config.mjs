import base from '../../../config/vitest.config.ts'

export default {
  ...base,
  test: {
    ...base.test,
    include: ['docs/audits/paired-host-partition-retention/store-removal.test.mjs'],
    maxWorkers: 1
  }
}
