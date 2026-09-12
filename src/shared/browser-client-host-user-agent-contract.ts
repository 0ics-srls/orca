import { z, type RefinementCtx } from 'zod'

export const BROWSER_CLIENT_HOST_USER_AGENT_CONTRACT_VERSION = 1 as const
export const BrowserClientHostUserAgentMode = z.enum(['clean', 'native'])

type NegotiatedUserAgentContract = {
  userAgentContractVersion?: 1
  pageCommandProtocolVersion?: 1
  pageInventoryProtocolVersion?: 1
}

export function refineBrowserClientHostAttachUserAgentContract(
  params: NegotiatedUserAgentContract & {
    pageInventory?: readonly { userAgentMode?: 'clean' | 'native' }[]
  },
  context: RefinementCtx
): void {
  if (
    params.userAgentContractVersion !== undefined &&
    (params.pageCommandProtocolVersion !== 1 || params.pageInventoryProtocolVersion !== 1)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Browser user-agent contract requires command and inventory negotiation'
    })
  }
  for (const [index, page] of (params.pageInventory ?? []).entries()) {
    if (params.userAgentContractVersion === 1 && page.userAgentMode === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Browser page inventory omits its user-agent mode',
        path: ['pageInventory', index, 'userAgentMode']
      })
    }
    if (params.userAgentContractVersion !== 1 && page.userAgentMode !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Browser page inventory did not negotiate its user-agent contract',
        path: ['pageInventory', index, 'userAgentMode']
      })
    }
  }
}

export function refineBrowserClientHostCommandUserAgentContract(
  event: NegotiatedUserAgentContract & {
    command: { type: string; userAgentMode?: 'clean' | 'native' }
  },
  context: RefinementCtx
): void {
  const profileCommand = ['createPage', 'reclaimPage', 'restorePage'].includes(event.command.type)
    ? event.command
    : null
  if (profileCommand && event.userAgentContractVersion === 1 && !profileCommand.userAgentMode) {
    context.addIssue({
      code: 'custom',
      message: 'Browser page command omits its user-agent mode',
      path: ['command', 'userAgentMode']
    })
  }
  if (profileCommand?.userAgentMode && event.userAgentContractVersion !== 1) {
    context.addIssue({
      code: 'custom',
      message: 'Browser page command did not negotiate its user-agent contract',
      path: ['userAgentContractVersion']
    })
  }
}
