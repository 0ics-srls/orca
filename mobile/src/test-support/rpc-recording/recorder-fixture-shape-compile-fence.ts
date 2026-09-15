import { mountFixture } from './recorder-fixture-shape'

/**
 * What `PartialRecorderFixture` accepts and refuses, as compile errors rather than as a claim.
 * `pnpm --dir mobile typecheck` covers this file and excludes every `.test.ts`, so a branch of that
 * type is only pinned here: without it the type still recorded zero errors, because no fixture in
 * the tree happens to carry a callback or a `Date`, and dropping either branch silently widened it
 * to accept a stub the mounted hook cannot call.
 */
type Fixture = {
  readonly onPick: (id: string) => void
  readonly at: Date
  readonly tags: ReadonlySet<string>
  readonly byId: ReadonlyMap<string, number>
  readonly labels: readonly { readonly name: string }[]
  readonly source: { readonly id: string } | undefined
}

export const accepted = mountFixture<Fixture>({
  onPick: () => {},
  labels: [{ name: 'bug' }],
  // JSON spells an absent object `null`, which the product type does not say
  source: null
})

export const refusedCallback = mountFixture<Fixture>({
  // @ts-expect-error a number cannot stand in for the callback the hook invokes
  onPick: 3
})

export const refusedDate = mountFixture<Fixture>({
  // @ts-expect-error a structural stand-in is not the Date the hook reads
  at: { getTime: 5 }
})

export const refusedSet = mountFixture<Fixture>({
  // @ts-expect-error an object with no Set members is not a Set
  tags: {}
})

export const refusedMap = mountFixture<Fixture>({
  // @ts-expect-error an object with no Map members is not a Map
  byId: {}
})

export const refusedMember = mountFixture<Fixture>({
  // @ts-expect-error the product type has no such member
  unknownMember: 'x'
})

export const refusedElement = mountFixture<Fixture>({
  // @ts-expect-error the element type has no such member
  labels: [{ nmae: 'bug' }]
})
