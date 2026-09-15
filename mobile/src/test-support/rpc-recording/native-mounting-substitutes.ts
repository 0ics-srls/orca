import * as React from 'react'
import { sha256 } from '@noble/hashes/sha256'
import * as zod from 'zod'

/**
 * The native modules a mounted operation may import, and what it gets instead.
 *
 * The loader's default is a proxy that throws on any property of a non-relative import, which is
 * what keeps an adapter from silently mounting a device API. That default is too strict for the
 * relay pairing modules: each builds a `defaultDependencies` object at module scope, so merely
 * *referencing* `Platform.OS` or a storage-backed loader throws before an adapter can override it.
 *
 * So the table separates reference from use. `react` and `zod` are the real libraries — pure, and
 * React additionally has to be the one instance the test renderer drives, and `@noble/hashes` is
 * the same pure-JS digest the product would run on a device. `expo-crypto` is routed through the
 * Web Crypto the recording scheduler already pins, which is both deterministic and what the library
 * itself does off-device.
 *
 * Every substitute that stands in for part of a module keeps the default's shape: a member nobody
 * listed throws on the read rather than resolving to `undefined`, because an undefined native
 * member is not a recording of anything — the product would call it. The secret store is the one
 * module whose members exist but throw when *called*: a default-dependency object may name them,
 * and a recording that reaches native storage fails there instead. Whether that failure is visible
 * depends on the caller. `host-app-version-store.ts` catches and degrades to its unread state,
 * which is what it does on a device too.
 */
function partialNativeModule(module: string, members: Record<string, unknown>): unknown {
  return new Proxy(members, {
    get: (target, key) => {
      // `import * as X` transpiles to an interop helper that probes this marker before copying
      // members; it is the module system asking, not product code reading an API.
      if (typeof key === 'string' && key !== '__esModule' && !(key in target)) {
        throw new Error(`Unsubstituted native member: ${module}.${key}`)
      }
      return Reflect.get(target, key)
    }
  })
}

function unusableNativeStore(module: string): unknown {
  return new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) => {
          void args
          throw new Error(`Native store reached during recording: ${module}.${String(key)}`)
        }
    }
  )
}

export function nativeMountingSubstitutes(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['react', React],
    ['zod', zod],
    ['@noble/hashes/sha256', partialNativeModule('@noble/hashes/sha256', { sha256 })],
    [
      'expo-crypto',
      partialNativeModule('expo-crypto', {
        getRandomBytes: (length: number) =>
          globalThis.crypto.getRandomValues(new Uint8Array(length))
      })
    ],
    // One pinned platform per recording; `platform` is golden provenance, not a compared field.
    ['react-native', partialNativeModule('react-native', { Platform: { OS: 'ios' } })],
    [
      '@react-native-async-storage/async-storage',
      unusableNativeStore('@react-native-async-storage/async-storage')
    ]
  ])
}
