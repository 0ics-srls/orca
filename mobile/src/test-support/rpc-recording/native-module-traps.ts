/**
 * The two traps a native substitute is built from.
 *
 * A partial module stands in for part of a package: the members a mounted operation reads, and a
 * refusal for the rest. A member nobody listed throws on the read rather than resolving to
 * `undefined`, because an undefined native member is not a recording of anything — the product
 * would call it. A store inverts that, reading every member back as a function that throws when
 * called: a default-dependency object may name them, and a recording that reaches one fails at the
 * call instead. Whether that failure is visible depends on the caller; `host-app-version-store.ts`
 * catches and degrades to its unread state, which is what it does on a device too.
 *
 * `__esModule` is exempt from both refusals, because it is the module system's interop marker
 * rather than a native API. A store leaves it undefined: the store *is* the default export, and
 * answering truthfully would bind `import X from` to the trap's own `default` instead of the trap,
 * leaving the consumer holding a member-less stand-in. A partial module answers it only when it
 * declares a `default` member, because `import X, { y }` compiles to `__importStar`, which
 * otherwise overwrites that default with the module object.
 */
export function partialNativeModule(module: string, members: Record<string, unknown>): unknown {
  return new Proxy(members, {
    get: (target, key) => {
      if (typeof key === 'string' && key !== '__esModule' && !(key in target)) {
        throw new Error(`Unsubstituted native member: ${module}.${key}`)
      }
      return Reflect.get(target, key)
    }
  })
}

/** A device event source with no events: registration succeeds, nothing is ever delivered. */
export function silentNativeSubscription(): { remove: () => void } {
  return { remove: () => {} }
}

/** A native store: the members a recording declared, and a throwing call for every other. */
export function nativeStoreModule(module: string, declared: Record<string, unknown> = {}): unknown {
  return new Proxy(declared, {
    get: (target, key) => {
      if (key === '__esModule') {
        return undefined
      }
      if (typeof key === 'string' && key in target) {
        return Reflect.get(target, key)
      }
      return (...args: unknown[]) => {
        void args
        throw new Error(`Native store reached during recording: ${module}.${String(key)}`)
      }
    }
  })
}
