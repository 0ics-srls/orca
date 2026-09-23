import { useEffect, useState } from 'react'

/**
 * The name this computer publishes to paired devices: the saved override, or the detected
 * computer name when that is blank. Read from the runtime rather than recomputed here, and re-read
 * whenever the saved override changes so the caption never names what devices used to see.
 */
export function usePublishedMachineName(savedOverride: string): string | null {
  const [machineName, setMachineName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const getRuntimeStatus = window.api.runtime?.getStatus
    if (!getRuntimeStatus) {
      return () => {
        cancelled = true
      }
    }
    // Why: settings writes reach the main process before the store publishes them, so a read
    // triggered by the saved value changing already sees the new name.
    void getRuntimeStatus()
      .then((status) => {
        if (!cancelled && typeof status.machineName === 'string' && status.machineName.trim()) {
          setMachineName(status.machineName.trim())
        }
      })
      .catch(() => {
        // The settings screen remains usable when the runtime is still starting.
      })
    return () => {
      cancelled = true
    }
  }, [savedOverride])

  return machineName
}
