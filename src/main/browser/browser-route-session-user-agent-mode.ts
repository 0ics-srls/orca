import type { BrowserSessionUserAgentMode } from '../../shared/browser-workspace-types'

export function assertReusableBrowserRouteUserAgentMode(
  current: BrowserSessionUserAgentMode,
  requested: BrowserSessionUserAgentMode
): void {
  if (current !== requested) {
    throw new Error('browser_route_partition_user_agent_mode_conflict')
  }
}
