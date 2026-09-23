import AsyncStorage from '@react-native-async-storage/async-storage'
import { z } from 'zod'
import { NODE_PLATFORM_NAMES } from './mobile-runtime-host-platform'

const STORAGE_KEY_PREFIX = 'orca:host-platform:v1:'
const storedPlatformSchema = z.enum(NODE_PLATFORM_NAMES)

export async function readPersistedHostPlatform(hostId: string): Promise<NodeJS.Platform | null> {
  try {
    const parsed = storedPlatformSchema.safeParse(await AsyncStorage.getItem(storageKey(hostId)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writePersistedHostPlatform(
  hostId: string,
  platform: NodeJS.Platform | null
): Promise<void> {
  try {
    if (platform) {
      await AsyncStorage.setItem(storageKey(hostId), platform)
    } else {
      await AsyncStorage.removeItem(storageKey(hostId))
    }
  } catch {
    // A display label must never affect host connectivity; the next status read rewrites it.
  }
}

function storageKey(hostId: string): string {
  return `${STORAGE_KEY_PREFIX}${hostId}`
}
