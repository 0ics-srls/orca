import { githubPrRepoSlugRead } from './github-pr-read-operations'

/**
 * What a session-screen operation needs to send with.
 *
 * Derived from an operation rather than restated, so accepting a client does not require a module
 * to name the raw request port. It stays exactly as narrow as the `Pick<RpcClient, 'sendRequest'>`
 * it replaces — widening it to `RpcClient` would make every unit test build a whole client.
 */
export type MobileSessionRpcSender = Parameters<typeof githubPrRepoSlugRead.request>[0]
