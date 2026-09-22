const MUSE_VERSIONED_BINARY_PREFIX = 'muse-bin-'

export function isMuseVersionedBinary(processName: string): boolean {
  return processName.startsWith(MUSE_VERSIONED_BINARY_PREFIX)
}

export function isMuseExpectedProcess(processName: string, expectedProcess: string): boolean {
  return expectedProcess === 'muse' && isMuseVersionedBinary(processName)
}
