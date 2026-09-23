import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { readPersistedHostPlatform, writePersistedHostPlatform } from './host-platform-persistence'

/**
 * The OS each paired host last reported in `status.get`, by host id — the one copy the host list and
 * the host screen both read. Pairing reuses a host id only for the same desktop key, so the record
 * names that machine even while it is offline; every readable status reply overwrites it.
 */
const platformByHostId = new Map<string, NodeJS.Platform | null>()
const loadStartedHostIds = new Set<string>()
// Loads whose stored copy may still be adopted; a live status reply or a removal supersedes them.
const adoptableLoadHostIds = new Set<string>()
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Records what a readable status reply said; `null` is a host that answered without a platform. */
export function recordHostPlatform(hostId: string, platform: NodeJS.Platform | null): void {
  loadStartedHostIds.add(hostId)
  adoptableLoadHostIds.delete(hostId)
  if (platformByHostId.has(hostId) && platformByHostId.get(hostId) === platform) {
    return
  }
  platformByHostId.set(hostId, platform)
  publish()
  void writePersistedHostPlatform(hostId, platform)
}

export function forgetHostPlatform(hostId: string): Promise<void> {
  loadStartedHostIds.add(hostId)
  adoptableLoadHostIds.delete(hostId)
  platformByHostId.delete(hostId)
  publish()
  return writePersistedHostPlatform(hostId, null)
}

function loadHostPlatform(hostId: string): void {
  if (loadStartedHostIds.has(hostId)) {
    return
  }
  loadStartedHostIds.add(hostId)
  adoptableLoadHostIds.add(hostId)
  void readPersistedHostPlatform(hostId).then((platform) => {
    if (adoptableLoadHostIds.delete(hostId) && platform) {
      platformByHostId.set(hostId, platform)
      publish()
    }
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHostPlatform(hostId: string | undefined): NodeJS.Platform | null {
  const read = useCallback(() => (hostId ? (platformByHostId.get(hostId) ?? null) : null), [hostId])
  const platform = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (hostId) {
      loadHostPlatform(hostId)
    }
  }, [hostId])
  return platform
}

export function resetHostPlatformStoreForTests(): void {
  platformByHostId.clear()
  loadStartedHostIds.clear()
  adoptableLoadHostIds.clear()
  listeners.clear()
}
