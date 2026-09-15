/**
 * The shape a recorder fixture may take for the product value it stands in for: every member
 * optional at every depth, but no member the real type does not have, and no member with the wrong
 * type. That is what a mount fixture actually is — deliberately partial, because it carries only
 * what the mounted hook reads, yet still a subset of the real thing.
 *
 * Type-only, and here rather than outside the recorder because `mobile/scripts/rpc-recording.mts`
 * fences every path under `mobile/src` except this directory, so a file outside it fails recording
 * as an unpinned product source. It sits in the engine rather than under `adapters/` because the
 * mount helper that uses it is copied per module and the seam forbids one module importing another,
 * so this is what stops eleven copies of a recursive conditional type from existing.
 *
 * Functions pass through whole: a fixture stub like `async () => 0` stands in for a callback, and
 * making its parameters optional would accept a stub the hook cannot call.
 *
 * A member may also be `null` even where the product type says only optional, because these
 * fixtures stand in for JSON the host sent and JSON spells an absent object `null`. Rejecting it
 * would push the fixtures away from what a host actually sends, not towards it.
 */
export type PartialRecorderFixture<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlySet<unknown> | ReadonlyMap<unknown, unknown> | Date
    ? T
    : T extends readonly (infer Element)[]
      ? readonly PartialRecorderFixture<Element>[]
      : T extends object
        ? { readonly [Key in keyof T]?: PartialRecorderFixture<T[Key]> | null }
        : T
