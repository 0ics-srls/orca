import base from '../../../config/vitest.config.ts'
export default {
  ...base,
  test: { ...base.test, include: ['docs/audits/editor-duplicate-issue-review/baseline.test.ts'] }
}
