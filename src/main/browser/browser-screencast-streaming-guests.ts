// Guests with a live screencast. A remote viewer keeps its page paintable on the desktop, so input
// to it needs no automation-visibility lease (which waits on desktop rAF, stalled while hidden).
const streamCountsByWebContentsId = new Map<number, number>()

export function markBrowserGuestStreaming(webContentsId: number): () => void {
  streamCountsByWebContentsId.set(
    webContentsId,
    (streamCountsByWebContentsId.get(webContentsId) ?? 0) + 1
  )
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const remaining = (streamCountsByWebContentsId.get(webContentsId) ?? 1) - 1
    if (remaining > 0) {
      streamCountsByWebContentsId.set(webContentsId, remaining)
    } else {
      streamCountsByWebContentsId.delete(webContentsId)
    }
  }
}

export function isBrowserGuestStreaming(webContentsId: number): boolean {
  return streamCountsByWebContentsId.has(webContentsId)
}
