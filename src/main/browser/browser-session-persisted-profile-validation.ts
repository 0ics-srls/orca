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

function hasRetiredUserAgentMode(profile: BrowserSessionProfile): boolean {
  return Object.hasOwn(profile, 'userAgentMode')
}

function withoutRetiredUserAgentMode(profile: BrowserSessionProfile): BrowserSessionProfile {
  if (!hasRetiredUserAgentMode(profile)) {
    return profile
  }
  const migrated = { ...profile }
  Reflect.deleteProperty(migrated, 'userAgentMode')
  return migrated
}

export function migrateRetiredBrowserSessionProfileUserAgentModes(
  profiles: BrowserSessionProfile[],
  activeOrcaProfileId: string
): { profiles: BrowserSessionProfile[]; nativeProfileIds: string[]; changed: boolean } {
  const nativeProfileIds = profiles
    .filter((profile) => isValidPersistedBrowserSessionProfile(profile, activeOrcaProfileId))
    .filter((profile) => Reflect.get(profile, 'userAgentMode') === 'native')
    .map((profile) => profile.id)
  return {
    profiles: profiles.map(withoutRetiredUserAgentMode),
    nativeProfileIds,
    changed: profiles.some(hasRetiredUserAgentMode)
  }
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
