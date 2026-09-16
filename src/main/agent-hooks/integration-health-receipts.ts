import { IntegrationHealthStore, readIntegrationHealthMetadata } from './integration-health'

/** Persist a loader/delivery receipt emitted by the host's validated hook receiver. */
export function recordIntegrationDelivery(input: {
  source: string
  body: unknown
  executionId: string | undefined
  paneKey: string
  host: 'local' | 'remote'
  healthFilePath: string
}): void {
  if (input.source !== 'opencode' && input.source !== 'auggie') {
    return
  }
  try {
    const metadata = readIntegrationHealthMetadata(input.body)
    const version =
      typeof metadata.version === 'string' && metadata.version.length > 0
        ? metadata.version
        : undefined
    const artifactId =
      typeof metadata.artifactId === 'string' && metadata.artifactId.length > 0
        ? metadata.artifactId
        : version
          ? `${input.source}:${version}`
          : undefined
    new IntegrationHealthStore({ filePath: input.healthFilePath }).recordDeliveryEvidence({
      integration: input.source,
      host: input.host,
      scope: input.paneKey,
      ...(artifactId ? { artifactId } : {}),
      ...(version ? { version } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
      // A valid plugin event proves loader acceptance; file materialization alone does not.
      loader: version ? 'loaded' : 'unknown',
      delivery: 'observed'
    })
  } catch {
    // Diagnostics are best effort and must not affect hook acceptance.
  }
}
