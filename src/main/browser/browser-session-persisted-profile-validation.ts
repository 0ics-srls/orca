import { getOrcaProfileBrowserSessionPartition } from '../../shared/orca-profiles'
import type { BrowserSessionProfile } from '../../shared/browser-workspace-types'

const BROWSER_SESSION_PROFILE_ID_RE =
  /^[\da-f-]{8}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{12}$/

// Why: validate on-disk profile shape so a tampered JSON file can't inject an arbitrary partition into the will-attach-webview allowlist.
export function isValidPersistedBrowserSessionProfile(
  profile: unknown,
  activeOrcaProfileId: string
): profile is BrowserSessionProfile {
  if (!profile || typeof profile !== 'object') {
    return false
  }
  const candidate = profile as Partial<BrowserSessionProfile>
  return (
    candidate.id !== 'default' &&
    candidate.scope !== 'default' &&
    typeof candidate.id === 'string' &&
    typeof candidate.partition === 'string' &&
    typeof candidate.label === 'string' &&
    isProfileOwnedSessionPartition(candidate.id, candidate.partition, activeOrcaProfileId)
  )
}

export function inspectRetiredBrowserSessionProfileUserAgentModes(
  profiles: readonly unknown[],
  activeOrcaProfileId: string
): { noticePending: boolean; degraded: boolean } {
  let noticePending = false
  let degraded = false
  for (const profile of profiles) {
    if (!isValidPersistedBrowserSessionProfile(profile, activeOrcaProfileId)) {
      noticePending = true
      degraded = true
      continue
    }
    if (!Object.hasOwn(profile, 'userAgentMode')) {
      continue
    }
    noticePending = true
    const mode = Reflect.get(profile, 'userAgentMode')
    if (mode !== 'clean' && mode !== 'native') {
      degraded = true
    }
  }
  return { noticePending, degraded }
}

function isProfileOwnedSessionPartition(
  profileId: string,
  partition: string,
  activeOrcaProfileId: string
): boolean {
  return (
    BROWSER_SESSION_PROFILE_ID_RE.test(profileId) &&
    partition === getOrcaProfileBrowserSessionPartition(activeOrcaProfileId, profileId)
  )
}
