import { useEffect, useState } from 'react'

export function useDetectedMachineName(): string | null {
  const [machineName, setMachineName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const getRuntimeStatus = window.api.runtime?.getStatus
    if (!getRuntimeStatus) {
      return () => {
        cancelled = true
      }
    }
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
  }, [])

  return machineName
}
