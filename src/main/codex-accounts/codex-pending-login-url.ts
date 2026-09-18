type PendingLoginUrlListener = (url: string | null) => void

/**
 * The sign-in link of the Codex login that is waiting on a browser right now.
 *
 * Kept outside the login session so a renderer that opens Settings midway
 * through a login can still ask for the link it never saw published.
 */
export class CodexPendingLoginUrl {
  private url: string | null = null
  private readonly listeners = new Set<PendingLoginUrlListener>()

  get(): string | null {
    return this.url
  }

  set(url: string | null): void {
    if (this.url === url) {
      return
    }
    this.url = url
    for (const listener of this.listeners) {
      try {
        listener(url)
      } catch (error) {
        console.warn('[codex-accounts] Pending login URL listener failed:', error)
      }
    }
  }

  subscribe(listener: PendingLoginUrlListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
