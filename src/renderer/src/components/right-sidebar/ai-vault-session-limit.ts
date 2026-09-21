export const AI_VAULT_SESSION_LIMITS = [250, 500, 1000, 'unlimited'] as const

export type AiVaultSessionLimit = (typeof AI_VAULT_SESSION_LIMITS)[number]

export const DEFAULT_AI_VAULT_SESSION_LIMIT: AiVaultSessionLimit = 250

export function normalizeAiVaultSessionLimit(value: unknown): AiVaultSessionLimit {
  return AI_VAULT_SESSION_LIMITS.includes(value as AiVaultSessionLimit)
    ? (value as AiVaultSessionLimit)
    : DEFAULT_AI_VAULT_SESSION_LIMIT
}

/** The next History depth step, or null once the scan is already unlimited. */
export function nextAiVaultSessionLimit(limit: AiVaultSessionLimit): AiVaultSessionLimit | null {
  return AI_VAULT_SESSION_LIMITS[AI_VAULT_SESSION_LIMITS.indexOf(limit) + 1] ?? null
}
