import base from '../../../config/vitest.config.ts'
export default {
  ...base,
  test: { ...base.test, include: ['docs/audits/rpc-inflight-admission-review/fixture.test.mjs'] }
}
