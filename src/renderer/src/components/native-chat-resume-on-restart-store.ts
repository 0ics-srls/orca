import type { ResumeCandidate } from './native-chat-resume-on-restart-grouping'

type Snapshot = Readonly<{
  candidates: readonly ResumeCandidate[]
  openRequested: boolean
}>

let snapshot: Snapshot = { candidates: [], openRequested: false }
const listeners = new Set<() => void>()

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

export function getNativeChatResumeOnRestartSnapshot(): Snapshot {
  return snapshot
}

export function subscribeNativeChatResumeOnRestart(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setNativeChatResumeOnRestartCandidates(
  candidates: readonly ResumeCandidate[]
): void {
  publish({ ...snapshot, candidates: [...candidates] })
}

export function requestNativeChatResumeOnRestartDialog(): void {
  publish({ ...snapshot, openRequested: true })
}

export function consumeNativeChatResumeOnRestartDialogRequest(): void {
  if (!snapshot.openRequested) {
    return
  }
  publish({ ...snapshot, openRequested: false })
}

export function clearNativeChatResumeOnRestartCandidates(): void {
  publish({ candidates: [], openRequested: false })
}
