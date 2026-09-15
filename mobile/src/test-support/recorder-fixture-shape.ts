/**
 * The shape a recorder fixture may take for the product value it stands in for: every member
 * optional at every depth, but no member the real type does not have, and no member with the wrong
 * type. That is what a mount fixture actually is — deliberately partial, because it carries only
 * what the mounted hook reads, yet still a subset of the real thing.
 *
 * Type-only and deliberately outside `rpc-recording/`, which every golden pins: a type cannot
 * change a recording, and the mount helper that uses it is copied per adapter module, so keeping
 * the type here is what stops eleven copies of it from existing.
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
