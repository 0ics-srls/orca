import { describe, expect, it } from 'vitest'
import { getOrcaProfileBrowserSessionPartition } from '../../shared/orca-profiles'
import { inspectRetiredBrowserSessionProfileUserAgentModes } from './browser-session-persisted-profile-validation'

const ORCA_PROFILE_ID = 'local-default'

function profileWithMode(mode: unknown): Record<string, unknown> {
  const id = '11111111-1111-4111-8111-111111111111'
  return {
    id,
    scope: 'isolated',
    partition: getOrcaProfileBrowserSessionPartition(ORCA_PROFILE_ID, id),
    label: 'Existing',
    source: null,
    userAgentMode: mode
  }
}

describe('retired browser profile identity inspection', () => {
  it('detects an inspectable old choice without removing its bytes', () => {
    const profile = profileWithMode('native')

    expect(
      inspectRetiredBrowserSessionProfileUserAgentModes([profile], ORCA_PROFILE_ID)
    ).toEqual({ noticePending: true, degraded: false })
    expect(profile.userAgentMode).toBe('native')
  })

  it.each([[null], [42], ['broken'], [profileWithMode('unexpected')]])(
    'turns malformed metadata into a degraded notice without throwing',
    (entry) => {
      expect(() =>
        inspectRetiredBrowserSessionProfileUserAgentModes([entry], ORCA_PROFILE_ID)
      ).not.toThrow()
      expect(
        inspectRetiredBrowserSessionProfileUserAgentModes([entry], ORCA_PROFILE_ID)
      ).toEqual({ noticePending: true, degraded: true })
    }
  )
})
