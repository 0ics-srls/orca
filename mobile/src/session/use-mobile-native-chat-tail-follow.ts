import { useCallback, useRef, useState, type RefObject } from 'react'
import type { FlatList } from 'react-native'

/** Distance from the bottom, in points, still treated as "at the tail". */
const AT_TAIL_SLOP = 80

export type MobileNativeChatTailFollow<TItem> = {
  /** Attach to the transcript list; the hook scrolls through this ref alone. */
  listRef: RefObject<FlatList<TItem> | null>
  /** Render flag for the jump-to-latest control. */
  following: boolean
  /** Passive maintenance: re-pin after the content or viewport resizes. */
  pinToTail: () => void
  /** Explicit jump — send, or the jump-to-latest control. Resumes following. */
  jumpToTail: () => void
  beginUserScroll: () => void
  finishUserScroll: () => void
  /** Leave the tail deliberately, e.g. before prepending older history. */
  detachFromTail: () => void
  recordScrollMetrics: (distanceFromBottom: number) => void
}

/** Sole owner of transcript scroll position.
 *
 *  Streaming used to have several tail-followers at once: a delayed *animated*
 *  `scrollToEnd` alongside an immediate non-animated one on content growth. The
 *  animated command eases toward the endpoint measured when it started, so while
 *  tokens kept arriving it ran backwards until the content-size pin yanked it
 *  forward — the visible drift-then-snap. One owner, never animated, removes it.
 *
 *  Intent (`following`) is kept separate from geometry (at-tail): a programmatic
 *  scroll reports metrics like any other, so letting metrics decide intent let
 *  the view argue with itself. Only the user's own gestures and explicit jumps
 *  move intent; metrics only decide where a *released* gesture leaves us.
 */
export function useMobileNativeChatTailFollow<TItem>(args: {
  /** Guards `scrollToEnd` against an empty list. */
  hasItems: boolean
}): MobileNativeChatTailFollow<TItem> {
  const { hasItems } = args
  const listRef = useRef<FlatList<TItem> | null>(null)
  const [following, setFollowingFlag] = useState(true)
  // Event handlers read intent at event time, before a re-render lands.
  const followingRef = useRef(true)
  const atTailRef = useRef(true)

  // Single writer, so the event-time ref and the render flag cannot disagree.
  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next
    setFollowingFlag(next)
  }, [])

  const pinToTail = useCallback(() => {
    if (!followingRef.current || !hasItems) {
      return
    }
    listRef.current?.scrollToEnd({ animated: false })
  }, [hasItems])

  const jumpToTail = useCallback(() => {
    atTailRef.current = true
    setFollowing(true)
    pinToTail()
  }, [pinToTail, setFollowing])

  const beginUserScroll = useCallback(() => setFollowing(false), [setFollowing])

  // Where the gesture left us decides whether following resumes.
  const finishUserScroll = useCallback(() => setFollowing(atTailRef.current), [setFollowing])

  const detachFromTail = useCallback(() => {
    atTailRef.current = false
    setFollowing(false)
  }, [setFollowing])

  const recordScrollMetrics = useCallback((distanceFromBottom: number) => {
    atTailRef.current = distanceFromBottom < AT_TAIL_SLOP
  }, [])

  return {
    listRef,
    following,
    pinToTail,
    jumpToTail,
    beginUserScroll,
    finishUserScroll,
    detachFromTail,
    recordScrollMetrics
  }
}
