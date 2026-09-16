// Why: the cell inventory lock is held to COMMIT, and the assignment path runs
// many statements after taking it. Tuning the request-path wait bound needs the
// hold distribution, and no runtime metric carried it before this change.
export type CellInventoryHoldCounts = {
  cellInventoryHoldMsMax: number
  cellInventoryHoldMsP95: number
  cellInventoryHolds: number
  // Why: NOWAIT acquisitions error instead of waiting, so a failed grab produces
  // no hold sample. Without this counter the hold metrics read healthy while the
  // lock is in a retry storm, which is how contention stayed invisible before.
  cellInventoryLockUnavailable: number
}

// Bounded so a flush interval with heavy assignment traffic cannot grow the array
// without limit; the reservoir keeps the most recent holds.
const MAX_SAMPLES = 2_048

export function emptyCellInventoryHoldCounts(): CellInventoryHoldCounts {
  return {
    cellInventoryHoldMsMax: 0,
    cellInventoryHoldMsP95: 0,
    cellInventoryHolds: 0,
    cellInventoryLockUnavailable: 0
  }
}

export class CellInventoryHoldSamples {
  private samples: number[] = []
  private unavailable = 0

  record(holdMs: number): void {
    if (!Number.isFinite(holdMs) || holdMs < 0) return
    if (this.samples.length === MAX_SAMPLES) this.samples.shift()
    this.samples.push(holdMs)
  }

  // Counted, not sampled: a failed acquisition has no duration to record.
  recordUnavailable(count = 1): void {
    if (!Number.isFinite(count) || count <= 0) return
    this.unavailable += count
  }

  consumeCounts(): CellInventoryHoldCounts {
    const counts = this.readCounts()
    this.samples = []
    this.unavailable = 0
    return counts
  }

  readCounts(): CellInventoryHoldCounts {
    if (this.samples.length === 0) {
      return { ...emptyCellInventoryHoldCounts(), cellInventoryLockUnavailable: this.unavailable }
    }
    const sorted = [...this.samples].sort((left, right) => left - right)
    return {
      cellInventoryHoldMsMax: round(sorted[sorted.length - 1]!),
      cellInventoryHoldMsP95: round(sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0),
      cellInventoryHolds: sorted.length,
      cellInventoryLockUnavailable: this.unavailable
    }
  }
}

function round(value: number): number {
  return Number(value.toFixed(3))
}
