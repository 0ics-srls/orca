// Pure auto-scroll logic for the native chat message list. The component owns
// the DOM ref and the imperative scroll; this module owns only the decisions —
// "are we near the bottom?", "should we stick on new content?", "show the jump
// affordance?" — so they can be unit-tested without a scroll container.

/** A scroll container's geometry. Mirrors the three DOM props we read so tests
 *  can pass plain numbers instead of a fake element. */
export type ScrollGeometry = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Pixels from the bottom within which we treat the view as "at the bottom" and
 *  keep it pinned as content arrives. A small slack absorbs sub-pixel rounding
 *  and the height jitter of a streaming last message. Whether a reader's own
 *  scroll leaves us following is a separate, stricter question — see
 *  `NATIVE_CHAT_FOLLOW_REARM_PX`. */
export const NATIVE_CHAT_BOTTOM_THRESHOLD_PX = 48

/** Distance in px from the bottom edge of the scroll range. */
export function distanceFromBottom(geometry: ScrollGeometry): number {
  return Math.max(0, geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop)
}

/** True when the viewport is close enough to the bottom that new content should
 *  keep it pinned (auto-scroll "attached"). */
export function isNearBottom(
  geometry: ScrollGeometry,
  threshold: number = NATIVE_CHAT_BOTTOM_THRESHOLD_PX
): boolean {
  return distanceFromBottom(geometry) <= threshold
}

/** Whether the "jump to latest" affordance should show: only when the user has
 *  detached (scrolled up) and there is actually scrollable content below. */
export function shouldShowJumpToLatest(
  isStuckToBottom: boolean,
  geometry: ScrollGeometry,
  threshold: number = NATIVE_CHAT_BOTTOM_THRESHOLD_PX
): boolean {
  if (isStuckToBottom) {
    return false
  }
  return distanceFromBottom(geometry) > threshold
}

/** Pixels from the bottom within which a reader's own scroll still counts as
 *  following the end.
 *
 *  Deliberately far stricter than `NATIVE_CHAT_BOTTOM_THRESHOLD_PX`, because the
 *  two answer different questions: that one asks whether the view is close
 *  enough to the end to keep pinning it there, this one asks whether the reader
 *  meant to stay. Sharing the wider band meant any step off the end smaller than
 *  it still counted as following, so every later chunk of stream carried the
 *  reader back down and there was no way to park just above the latest message.
 *
 *  Sized to cover only what is not a decision: fractional-pixel and zoom
 *  rounding at the true end, at twice the epsilon the scroll marks already treat
 *  as offset noise, and well inside one line of prose so scrolling up a single
 *  line parks. */
export const NATIVE_CHAT_FOLLOW_REARM_PX = 4

export type FollowIntent = {
  following: boolean
  /** Whether the scroll event matches an offset the application registered. */
  programmatic: boolean
  geometry: ScrollGeometry
}

/** Whether the transcript should still follow the end after this offset.
 *
 *  Application writes preserve intent even when their delayed events arrive
 *  after the end moved. Reader events detach away from the end and reattach at
 *  it — against the re-arm band, never the wider near-bottom one. */
export function nextFollowingEnd(intent: FollowIntent): boolean {
  if (intent.programmatic) {
    return intent.following
  }
  return isNearBottom(intent.geometry, NATIVE_CHAT_FOLLOW_REARM_PX)
}

/** Distance from the top within which the transcript pages in older history. */
export const NATIVE_CHAT_LOAD_EARLIER_THRESHOLD_PX = 80

export type LoadEarlierIntent = {
  geometry: ScrollGeometry
  /** Offset at the previous scroll event; a prepend or a bottom pin moves down. */
  previousScrollTop: number
  hasMore: boolean
  loadingEarlier: boolean
  itemCount: number
  /** Item count when the last page was asked for, or null if none has been. */
  requestedAtItemCount: number | null
}

/** Whether reaching this offset should page in older history.
 *
 *  Windowing makes the naive "am I near the top?" test unsafe: every row that
 *  resolves its real height changes the content height and re-fires the
 *  observers that ask. So the answer also requires the view to have moved
 *  *upwards* — measurement settling and the bottom pin both move it down — and
 *  requires new items since the last request, which caps a stuck near-top view at
 *  one request per page rather than one per measurement. */
export function shouldLoadEarlier(intent: LoadEarlierIntent): boolean {
  if (!intent.hasMore || intent.loadingEarlier) {
    return false
  }
  if (intent.geometry.scrollTop >= NATIVE_CHAT_LOAD_EARLIER_THRESHOLD_PX) {
    return false
  }
  if (intent.geometry.scrollTop > intent.previousScrollTop) {
    return false
  }
  return intent.requestedAtItemCount !== intent.itemCount
}
