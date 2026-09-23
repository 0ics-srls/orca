import { parsePaneKey } from '../../shared/stable-pane-id'

/** A caller-minted `tabId:leafId` as the pair `createTerminal` adopts; an unparsable key yields
 *  nothing, so the runtime mints its own and the reported `paneKey` shows the caller it lost. */
export function paneIdentity(paneKey: string | undefined): { tabId?: string; leafId?: string } {
  const pane = paneKey ? parsePaneKey(paneKey) : null
  return pane ? { tabId: pane.tabId, leafId: pane.leafId } : {}
}
