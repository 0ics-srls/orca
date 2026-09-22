/** The ancestry an observer reads; every capture tier's row shape satisfies it. */
export type ObservableProcessRow = { pid: number; ppid: number; pgid?: number | undefined }

type ProcessTableCaptureListener = (rows: readonly ObservableProcessRow[]) => void

const captureListeners = new Set<ProcessTableCaptureListener>()

/**
 * Observe every shared process-table capture Orca takes, whatever reason it was
 * taken for. Anything tracking live process ancestry subscribes here rather than
 * polling: the capture is already paid for, and with no subscribers nothing is
 * parsed on their behalf. Returns an unsubscribe.
 */
export function onProcessTableCapture(listener: ProcessTableCaptureListener): () => void {
  captureListeners.add(listener)
  return () => captureListeners.delete(listener)
}

/** Parses a capture for observers only when some subscriber will actually read it. */
export function notifyProcessTableCapture(readRows: () => readonly ObservableProcessRow[]): void {
  if (captureListeners.size === 0) {
    return
  }
  const rows = readRows()
  for (const listener of captureListeners) {
    try {
      listener(rows)
    } catch {
      // An observer must never fail the capture its subscribers are sharing.
    }
  }
}
