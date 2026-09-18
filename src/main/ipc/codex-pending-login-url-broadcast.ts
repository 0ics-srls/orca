import { BrowserWindow } from 'electron'

export const CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL = 'codexAccounts:pendingLoginUrlChanged'

export function broadcastCodexPendingLoginUrl(url: string | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL, url)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}
