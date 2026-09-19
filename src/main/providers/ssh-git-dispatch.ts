import type { SshGitProvider } from './ssh-git-provider'

const sshProviders = new Map<string, SshGitProvider>()
const sshProviderGenerations = new Map<string, number>()
const SSH_PROVIDER_GENERATION_MAX_ENTRIES = 512

export const SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE =
  'Remote connection dropped. Click Reconnect on the SSH target before retrying.'

export function registerSshGitProvider(connectionId: string, provider: SshGitProvider): void {
  sshProviders.set(connectionId, provider)
  sshProviderGenerations.set(connectionId, (sshProviderGenerations.get(connectionId) ?? 0) + 1)
  pruneProviderGenerations()
}

export function unregisterSshGitProvider(connectionId: string): void {
  if (sshProviders.delete(connectionId)) {
    sshProviderGenerations.set(connectionId, (sshProviderGenerations.get(connectionId) ?? 0) + 1)
    pruneProviderGenerations()
  }
}

// Connection ids are externally supplied and can churn across repeated SSH
// sessions. Keep recent generations for cache invalidation without retaining
// every retired target for the lifetime of the main process.
function pruneProviderGenerations(): void {
  while (sshProviderGenerations.size > SSH_PROVIDER_GENERATION_MAX_ENTRIES) {
    const oldest = sshProviderGenerations.keys().next()
    if (oldest.done) {
      return
    }
    sshProviderGenerations.delete(oldest.value)
  }
}

export function getSshGitProviderGeneration(connectionId: string): number {
  return sshProviderGenerations.get(connectionId) ?? 0
}

/** @internal - exposed for cache-bound regression tests. */
export function _getSshGitProviderGenerationCacheSize(): number {
  return sshProviderGenerations.size
}

export function getSshGitProvider(connectionId: string): SshGitProvider | undefined {
  return sshProviders.get(connectionId)
}

export function requireSshGitProvider(connectionId: string): SshGitProvider {
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  return provider
}
