import { describe, expect, it } from 'vitest'
import { codexStructuredPermissionPolicyForSettings } from './codex-structured-permission-policy'

const BYPASS = { approvalPolicy: 'never', sandbox: 'danger-full-access' }

describe('codexStructuredPermissionPolicyForSettings', () => {
  it('bypasses when the user has never opened Agent settings', () => {
    expect(codexStructuredPermissionPolicyForSettings({ agentDefaultArgs: {} })).toEqual(BYPASS)
    expect(codexStructuredPermissionPolicyForSettings({})).toEqual(BYPASS)
    expect(codexStructuredPermissionPolicyForSettings(null)).toEqual(BYPASS)
    expect(
      codexStructuredPermissionPolicyForSettings({ agentDefaultArgs: { claude: '' } })
    ).toEqual(BYPASS)
  })

  it('bypasses when Yolo wrote the flag, alone or beside other tokens', () => {
    for (const codex of [
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-approvals-and-sandbox --model gpt-5.6-sol',
      '--model gpt-5.6-sol --dangerously-bypass-approvals-and-sandbox'
    ]) {
      expect(
        codexStructuredPermissionPolicyForSettings({ agentDefaultArgs: { codex } }),
        codex
      ).toEqual(BYPASS)
    }
  })

  it('leaves the approval prompts on when Manual cleared the flag', () => {
    expect(
      codexStructuredPermissionPolicyForSettings({ agentDefaultArgs: { codex: '' } })
    ).toBeUndefined()
  })

  // The passthrough that used to carry these to app-server is gone on purpose; only the
  // permission posture is derived, and nothing else from the field reaches argv.
  it('carries nothing but the permission posture out of the arguments field', () => {
    expect(
      codexStructuredPermissionPolicyForSettings({
        agentDefaultArgs: {
          codex: '--profile review --add-dir /repo -c model_reasoning_effort=high'
        }
      })
    ).toBeUndefined()
  })
})
