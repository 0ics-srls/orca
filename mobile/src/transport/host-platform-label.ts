import { hostPlatformDisplayName } from '../../../src/shared/host-platform-label'

export function hostPlatformLabel(platform: NodeJS.Platform | null | undefined): string | null {
  return hostPlatformDisplayName(platform)
}
