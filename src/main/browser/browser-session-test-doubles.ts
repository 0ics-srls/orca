import type { Session } from 'electron'

/**
 * Electron.Session stand-ins for the session-identity tests. That path reaches only
 * `webRequest.onBeforeSendHeaders`, `getUserAgent`, and the object identity itself — the
 * user-agent mode registry keys a WeakMap on the Session — so a partial literal is faithful,
 * and any member it did reach that the literal omits throws here instead of passing silently.
 */
export function asBrowserSessionDouble(double: object): Session {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial Session double; the identity path touches only the members named above, and a missing one throws rather than passing silently.
  return double as unknown as Session
}
