import type { HttpLinkAction } from '@/lib/http-link-destinations'

export type LinkActionKind = 'url' | 'file' | 'workspace' | 'terminal' | 'task'

/** A pending destination choice for one clicked link, anchored at the pointer. */
export type LinkActionRequest = {
  anchorX: number
  anchorY: number
  destination: string
  kind: LinkActionKind
  primary: HttpLinkAction
  alternate?: HttpLinkAction
  /** Hands focus back to the surface that owned the click (terminal, chat transcript). */
  restoreFocus: () => void
}

export function closeLinkActionRequest<T extends LinkActionRequest>(
  current: T | null,
  dismissed?: T
): T | null {
  return dismissed && current !== dismissed ? current : null
}
