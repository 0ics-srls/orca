import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { fetchActiveClaudeRateLimits } from './claude-active-usage-fetch'
import type { InactiveClaudeAccount } from './claude-managed-account-credentials'
import { fetchInactiveClaudeAccountUsage } from './claude-managed-account-usage'
import type {
  ClaudeManagedAccountUsageOptions,
  ClaudeRateLimitFetchOptions
} from './claude-usage-fetch-options'

export async function fetchClaudeRateLimits(
  options?: ClaudeRateLimitFetchOptions
): Promise<ProviderRateLimits> {
  return fetchActiveClaudeRateLimits(options)
}

export async function fetchManagedAccountUsage(
  account: InactiveClaudeAccount,
  options: ClaudeManagedAccountUsageOptions = {}
): Promise<ProviderRateLimits> {
  return fetchInactiveClaudeAccountUsage(account, options)
}
