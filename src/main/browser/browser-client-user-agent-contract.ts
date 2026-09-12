import type { BrowserClientHostCommandEvent } from '../../shared/browser-client-host-protocol'
import { BrowserClientPageCommandError } from './browser-client-page-command-failure'

export function assertBrowserClientUserAgentContract(event: BrowserClientHostCommandEvent): void {
  if (
    event.command.type !== 'createPage' &&
    event.command.type !== 'reclaimPage' &&
    event.command.type !== 'restorePage'
  ) {
    return
  }
  if (event.userAgentContractVersion !== 1 || !event.command.userAgentMode) {
    throw new BrowserClientPageCommandError('browser_client_user_agent_contract_required')
  }
}
