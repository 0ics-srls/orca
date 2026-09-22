import {
  REQUEST_ACTIVE_TERMINAL_PANE_CLOSE_EVENT,
  type RequestActiveTerminalPaneCloseDetail
} from '@/constants/terminal'

/** Asks the mounted pane of `tabId` to close its active split, with the usual running-process confirmation. */
export function requestActiveTerminalPaneClose(tabId: string): void {
  window.dispatchEvent(
    new CustomEvent<RequestActiveTerminalPaneCloseDetail>(
      REQUEST_ACTIVE_TERMINAL_PANE_CLOSE_EVENT,
      { detail: { tabId } }
    )
  )
}

/** The mounted pane's side of `requestActiveTerminalPaneClose`. Returns the unsubscribe. */
export function onActiveTerminalPaneCloseRequest(
  tabId: string,
  closeActivePane: () => void
): () => void {
  const onRequest = (event: Event): void => {
    const detail = (event as CustomEvent<RequestActiveTerminalPaneCloseDetail>).detail
    if (detail?.tabId === tabId) {
      closeActivePane()
    }
  }
  window.addEventListener(REQUEST_ACTIVE_TERMINAL_PANE_CLOSE_EVENT, onRequest)
  return () => window.removeEventListener(REQUEST_ACTIVE_TERMINAL_PANE_CLOSE_EVENT, onRequest)
}
