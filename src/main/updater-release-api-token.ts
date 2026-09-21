import { ghExecFileAsync } from './git/runner'

/**
 * The github.com token the release picker attaches to its api.github.com calls.
 *
 * Why: an unauthenticated request draws from a 60/hour bucket shared by every
 * caller behind the same public IP — Homebrew, other apps, agents running curl
 * — so the picker can find it empty without ever having spent it. The user's
 * own token has its own 5000/hour bucket. `gh auth token` is a local keyring
 * read that never touches the API; a missing or logged-out gh just means the
 * request goes out unauthenticated as before. The token is never logged.
 *
 * Why not resolveGhAccountToken: that resolves a per-project bound account and
 * needs a binding plus a `gh auth token --user` capability probe. This is the
 * ambient login, and "no token" is an ordinary outcome here, not an error.
 */

const TOKEN_RESOLVE_TIMEOUT_MS = 5_000
// Why one TTL for hits and misses: a miss re-spawns gh — through wsl.exe on a
// Windows box without a native gh — so a short miss TTL would make the picker
// slower for exactly the users who can never get a token.
const TOKEN_TTL_MS = 5 * 60_000

type TokenCacheEntry = { token: string | null; expiresAt: number }

let cached: TokenCacheEntry | null = null
let inFlight: Promise<string | null> | null = null

async function readGhToken(): Promise<string | null> {
  try {
    // Why no retry: a hung keyring would otherwise hold the picker through the
    // runner's backoff, and unauthenticated is an acceptable fallback anyway.
    const { stdout } = await ghExecFileAsync(['auth', 'token', '--hostname', 'github.com'], {
      timeout: TOKEN_RESOLVE_TIMEOUT_MS,
      idempotent: false
    })
    const token = stdout.replace(/\r?\n/g, '').trim()
    return token || null
  } catch {
    return null
  }
}

export async function resolveReleaseApiToken(now: number = Date.now()): Promise<string | null> {
  if (cached && cached.expiresAt > now) {
    return cached.token
  }
  if (inFlight) {
    return inFlight
  }
  inFlight = readGhToken()
    .then((token) => {
      cached = { token, expiresAt: now + TOKEN_TTL_MS }
      return token
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** GitHub rejected the token: go unauthenticated for a TTL instead of re-reading the same stale keyring entry on every load. */
export function rejectReleaseApiToken(now: number = Date.now()): void {
  cached = { token: null, expiresAt: now + TOKEN_TTL_MS }
}

/** @internal — test-only */
export function _resetReleaseApiTokenCache(): void {
  cached = null
  inFlight = null
}
