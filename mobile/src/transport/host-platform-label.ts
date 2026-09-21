import type { NODE_PLATFORM_NAMES } from './mobile-runtime-host-platform'

const PLATFORM_LABELS: Record<(typeof NODE_PLATFORM_NAMES)[number], string> = {
  aix: 'AIX',
  android: 'Android',
  cygwin: 'Cygwin',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
  haiku: 'Haiku',
  linux: 'Linux',
  netbsd: 'NetBSD',
  openbsd: 'OpenBSD',
  sunos: 'Solaris',
  win32: 'Windows'
}

export function hostPlatformLabel(platform: NodeJS.Platform | null | undefined): string | null {
  return platform ? PLATFORM_LABELS[platform] : null
}
