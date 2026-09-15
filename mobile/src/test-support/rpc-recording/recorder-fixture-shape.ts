/**
 * The shape a recorder fixture may take for the product value it stands in for: every member
 * optional at every depth, but no member the real type does not have, and no member with the wrong
 * type. That is what a mount fixture actually is — deliberately partial, because it carries only
 * what the mounted hook reads, yet still a subset of the real thing.
 *
 * Here rather than outside the recorder because `mobile/scripts/rpc-recording.mts` fences every
 * path under `mobile/src` except this directory, so a file outside it fails recording as an unpinned
 * product source. In the engine rather than under `adapters/` because the seam forbids one adapter
 * importing another, and every adapter may import the engine.
 *
 * Functions pass through whole: a fixture stub like `async () => 0` stands in for a callback, and
 * making its parameters optional would accept a stub the hook cannot call. That branch is also what
 * refuses a structural stand-in for a `Date`, whose members are all methods. A set or a map has
 * members that are not, so those two pass through whole as well.
 *
 * A member may also be `null` even where the product type says only optional, because these
 * fixtures stand in for JSON the host sent and JSON spells an absent object `null`. Rejecting it
 * would push the fixtures away from what a host actually sends, not towards it.
 */
export type PartialRecorderFixture<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>
    ? T
    : T extends readonly (infer Element)[]
      ? readonly PartialRecorderFixture<Element>[]
      : T extends object
        ? { readonly [Key in keyof T]?: PartialRecorderFixture<T[Key]> | null }
        : T

/**
 * The recorder supplies only the members the mounted action reads; completing the fixture into a
 * full domain object would invent data no scenario observes. `NoInfer` makes the target the
 * parameter's type rather than the fixture's, so a member the real type does not have is an error
 * here instead of a silently wrong recording.
 */
export function mountFixture<T>(value: PartialRecorderFixture<NoInfer<T>>): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: checked as a deep subset of T above; the recorder supplies every member the action reads.
  return value as T
}
