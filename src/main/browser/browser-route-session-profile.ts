import type {
  BrowserSessionProfile,
  BrowserSessionUserAgentMode
} from '../../shared/browser-workspace-types'
import { installBrowserRoutePartitionPolicies } from './browser-session-route-policies'

export function resolveBrowserRouteSessionProfile(input: {
  partition: string
  browserProfileId: string
  authoritativeUserAgentMode?: BrowserSessionUserAgentMode
  localProfile?: BrowserSessionProfile
}): BrowserSessionProfile {
  if (input.authoritativeUserAgentMode === undefined && !input.localProfile) {
    throw new Error('browser_route_partition_profile_unavailable')
  }
  return {
    id: input.browserProfileId,
    scope: 'isolated',
    partition: input.partition,
    label: input.browserProfileId,
    source: null,
    userAgentMode: input.authoritativeUserAgentMode ?? input.localProfile?.userAgentMode ?? 'clean'
  }
}

export function installBrowserRouteSessionProfilePolicies(input: {
  partition: string
  browserProfileId: string
  authoritativeUserAgentMode?: BrowserSessionUserAgentMode
  localProfile?: BrowserSessionProfile
}): void {
  installBrowserRoutePartitionPolicies(resolveBrowserRouteSessionProfile(input), input.partition)
}
