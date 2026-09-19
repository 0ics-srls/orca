const generationByEnvironment = new Map<string, number>()
const MAX_TRACKED_ENVIRONMENTS = 512

export function getRuntimeEnvironmentTransportGeneration(environmentId: string): number {
  return generationByEnvironment.get(environmentId) ?? 0
}

export function advanceRuntimeEnvironmentTransportGeneration(environmentId: string): void {
  generationByEnvironment.set(
    environmentId,
    getRuntimeEnvironmentTransportGeneration(environmentId) + 1
  )
  while (generationByEnvironment.size > MAX_TRACKED_ENVIRONMENTS) {
    const oldest = generationByEnvironment.keys().next()
    if (oldest.done) {
      break
    }
    generationByEnvironment.delete(oldest.value)
  }
}

export function _getRuntimeEnvironmentTransportGenerationCacheSize(): number {
  return generationByEnvironment.size
}
