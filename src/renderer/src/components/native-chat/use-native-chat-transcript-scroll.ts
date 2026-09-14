// The transcript's scroll behaviour: staying pinned to the bottom while a turn
// streams, offering the way back when the reader has left, aligning a row or a
// card to the top, and paging in older history.
//
// Split from the list because windowing changed what these have to be careful
// about, not what they decide: rows resolving their measured height move the
// content constantly, so "the content changed" and "the reader scrolled" stopped
// being the same event and only the latter may ask for another page.
//
// The offset belongs to the virtualizer — every pin goes through it, so a scroll
// it is still reconciling is replaced rather than raced, and its end test is the
// one this file asks. Whether the reader has left is then a question of
// provenance, not distance: see `nextFollowingEnd`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  isNearBottom,
  nextFollowingEnd,
  shouldLoadEarlier,
  shouldShowJumpToLatest,
  type ScrollGeometry
} from './native-chat-autoscroll'

function geometryOf(element: HTMLElement): ScrollGeometry {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  }
}

export type NativeChatTranscriptScroll = {
  showJump: boolean
  onScroll: () => void
  scrollToBottom: () => void
  /** Align an element inside the transcript with the top of the viewport. */
  scrollMessageToTop: (element: HTMLElement) => void
}

export function useNativeChatTranscriptScroll({
  scrollRef,
  contentRef,
  itemCount,
  isWorking,
  showTypingIndicator,
  hasMore,
  loadingEarlier,
  loadEarlier,
  alignToViewportTop,
  scrollToEnd
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  itemCount: number
  isWorking: boolean
  showTypingIndicator: boolean
  hasMore: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
  alignToViewportTop: (element: HTMLElement) => void
  scrollToEnd: () => void
}): NativeChatTranscriptScroll {
  const [showJump, setShowJump] = useState(false)
  const followingRef = useRef(true)
  const previousScrollTopRef = useRef(0)
  const loadEarlierRequestedAtRef = useRef<number | null>(null)
  // Where the last pin actually landed, read back rather than assumed: the
  // virtualizer clamps to the container's real maximum, which is rarely the
  // offset any caller had in mind.
  const pinnedOffsetRef = useRef<number | null>(null)

  const pinToEnd = useCallback(() => {
    scrollToEnd()
    const element = scrollRef.current
    if (!element) {
      return
    }
    const geometry = geometryOf(element)
    // Only a pin that actually reached the end proves we authored this offset.
    // The virtualizer declines to scroll when it has no measurement for the last
    // row, and recording that no-op would certify an offset we never chose —
    // follow state would then hold there for good.
    if (isNearBottom(geometry)) {
      pinnedOffsetRef.current = geometry.scrollTop
    }
  }, [scrollRef, scrollToEnd])

  const syncScrollState = useCallback((): ScrollGeometry | null => {
    const element = scrollRef.current
    if (!element) {
      return null
    }
    const geometry = geometryOf(element)
    const following = nextFollowingEnd({
      following: followingRef.current,
      pinnedOffset: pinnedOffsetRef.current,
      scrollTop: geometry.scrollTop,
      // Live geometry, never the virtualizer's `isAtEnd`: that one subtracts a
      // *cached* scroll offset from a *live* maximum, and this handler runs
      // before the virtualizer's own scroll listener refreshes the cache. On
      // growth it over-reports the distance and would detach a reader sitting
      // exactly at the bottom.
      atEnd: isNearBottom(geometry)
    })
    followingRef.current = following
    setShowJump(shouldShowJumpToLatest(following, geometry))
    return geometry
  }, [scrollRef])

  // Only a real scroll event pages in older history. Every row that resolves its
  // true height moves the content and re-fires the size observers; routing those
  // through here too would ask for the next page once per measurement.
  const onScroll = useCallback(() => {
    const geometry = syncScrollState()
    if (!geometry) {
      return
    }
    const previousScrollTop = previousScrollTopRef.current
    previousScrollTopRef.current = geometry.scrollTop
    if (
      shouldLoadEarlier({
        geometry,
        previousScrollTop,
        hasMore,
        loadingEarlier,
        itemCount,
        requestedAtItemCount: loadEarlierRequestedAtRef.current
      })
    ) {
      loadEarlierRequestedAtRef.current = itemCount
      loadEarlier()
    }
  }, [hasMore, itemCount, loadEarlier, loadingEarlier, syncScrollState])

  const scrollToBottom = useCallback(() => {
    pinToEnd()
    followingRef.current = true
    setShowJump(false)
  }, [pinToEnd])

  const scrollMessageToTop = useCallback(
    (element: HTMLElement) => {
      followingRef.current = false
      // The reveal owns the offset it is about to scroll to, so no pin of ours
      // may claim it.
      pinnedOffsetRef.current = null
      alignToViewportTop(element)
    },
    [alignToViewportTop]
  )

  useLayoutEffect(() => {
    if (followingRef.current) {
      pinToEnd()
    }
  }, [itemCount, isWorking, showTypingIndicator, pinToEnd])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      if (followingRef.current) {
        pinToEnd()
      } else {
        syncScrollState()
      }
    })
    // Observe the growing content, not just the fixed-height viewport, so an
    // in-place streaming growth is seen; also watch the viewport for reflows.
    observer.observe(element)
    if (contentRef.current) {
      observer.observe(contentRef.current)
    }
    return () => observer.disconnect()
  }, [contentRef, pinToEnd, scrollRef, syncScrollState])

  return { showJump, onScroll, scrollToBottom, scrollMessageToTop }
}
