import { describe, expect, it } from 'vitest'
import { resumeFailureGuidance } from './native-chat-resume-failure-guidance'

// Retry is offered as the primary action only where a second attempt can succeed. A refusal that
// stands sends the user to the chat, the only place it can be continued.
describe('resumeFailureGuidance', () => {
  it.each([
    ['agent_session_restart_work_superseded', 'open', null],
    ['agent_session_dispatch_rejected', 'open', null],
    ['agent_session_conflict', 'retry', 'open'],
    ['agent_session_ownership_unknown', 'retry', 'open'],
    ['execution_owner_reconciling', 'retry', 'open'],
    ['agent_session_not_attached', 'retry', 'open'],
    ['agent_session_send_failed', 'retry', 'open'],
    ['agent_session_resume_not_eligible', 'open', 'dismiss'],
    ['structured_agent_session_unsupported', 'open', 'dismiss'],
    ['agent_session_identity_required', 'open', 'dismiss'],
    ['something_this_build_has_never_seen', 'open', 'retry']
  ] as const)('maps %s to %s / %s', (reason, primary, secondary) => {
    const guidance = resumeFailureGuidance({ outcome: 'refused', reason })
    expect(guidance).toMatchObject({ primary, secondary })
    expect(guidance.text.length).toBeGreaterThan(0)
  })

  it('never offers a retry for a delivery nobody could confirm', () => {
    expect(
      resumeFailureGuidance({ outcome: 'unconfirmed', reason: 'agent_session_conflict' })
    ).toMatchObject({ primary: 'open', secondary: null })
  })
})
