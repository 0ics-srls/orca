import { randomUUID } from 'node:crypto'

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  TerminalTabCloseRequest,
  TerminalTabCloseResponse
} from '../../shared/terminal-tab-close'

const TERMINAL_TAB_CLOSE_TIMEOUT_MS = 20_000

export async function requestTerminalTabCloseFromRenderer(
  mainWindow: BrowserWindow,
  tabId: string,
  options: { localPtyTeardownOwnedExternally?: boolean; force?: boolean } = {}
): Promise<void> {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    throw new Error('renderer_unavailable')
  }
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const onRendererUnavailable = (): void => finish(new Error('renderer_unavailable'))
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      if (typeof mainWindow.removeListener === 'function') {
        mainWindow.removeListener('closed', onRendererUnavailable)
      }
      if (typeof mainWindow.webContents.removeListener === 'function') {
        mainWindow.webContents.removeListener('destroyed', onRendererUnavailable)
        mainWindow.webContents.removeListener('render-process-gone', onRendererUnavailable)
      }
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timeout = setTimeout(
      () => finish(new Error('terminal_tab_close_timeout')),
      TERMINAL_TAB_CLOSE_TIMEOUT_MS
    )
    const onResponse = (event: Electron.IpcMainEvent, response: TerminalTabCloseResponse): void => {
      // Why: request IDs are visible to renderer code; only the selected main
      // window may commit or reject its lifecycle transaction.
      if (event.sender !== mainWindow.webContents || response.requestId !== requestId) {
        return
      }
      if (response.error) {
        finish(new Error(response.error))
      } else {
        finish()
      }
    }
    ipcMain.on('ui:terminalTabCloseResponse', onResponse)
    if (typeof mainWindow.once === 'function') {
      mainWindow.once('closed', onRendererUnavailable)
    }
    if (typeof mainWindow.webContents.once === 'function') {
      mainWindow.webContents.once('destroyed', onRendererUnavailable)
      mainWindow.webContents.once('render-process-gone', onRendererUnavailable)
    }
    const request: TerminalTabCloseRequest = { requestId, tabId, ...options }
    try {
      mainWindow.webContents.send('ui:terminalTabCloseRequest', request)
    } catch {
      finish(new Error('renderer_unavailable'))
    }
  })
}
