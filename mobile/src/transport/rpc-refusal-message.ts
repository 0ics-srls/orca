/**
 * A refused operation's message, or the screen's own copy when the host sent none.
 *
 * Call sites spelled this as `response.error?.message || fallback`. Once the refusal arrives as
 * the acceptance policy's thrown Error, the `||` has to live somewhere — and it must not also
 * cover a transport rejection, whose message main surfaced verbatim, empty string included. So
 * a migrated call site keeps two catches where it had two paths, and only the refusal one calls
 * this.
 */
export function refusedRpcMessageOrFallback(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : '') || fallback
}

/**
 * An error a host reported inside an accepted reply, or the screen's copy when it sent none.
 * Preserves `result?.error || fallback`: only an absent or empty host error falls back.
 */
export function hostReplyErrorTextOrFallback(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value || fallback
  }
  return value ? String(value) : fallback
}
