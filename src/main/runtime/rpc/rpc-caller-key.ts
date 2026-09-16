/**
 * The identity an RPC caller's durable state is filed under.
 *
 * One function because the alternative is the same chain written out at each site, and they have to
 * agree: a create dedupe key, an operation ledger and the identity a launch commits all answer "who
 * is the caller", or a retry from the same device reads as a different caller and starts a second
 * agent. `terminal.create` is the site this was lifted from, so the semantics here are the shipped
 * ones rather than a fresh guess.
 *
 * The order is the rule stated on `RpcContext`: key by the revocable device identity, never by the
 * bearer credential. `pairedDeviceId` survives a reconnect and dies when the pairing is revoked;
 * `clientId` is the device token, which is why it is only the fallback for a caller that has not
 * paired. An in-process caller is the host itself and shares one key.
 *
 * `terminal.ensureAgentSession` / `terminal.createAgentSession` deliberately do NOT use this: they
 * pass `pairedDeviceId ?? clientId` through undefined, and collapsing an in-process caller onto
 * `local` there would change what their caller context keys on.
 */

export type RpcCaller = {
  pairedDeviceId?: string
  clientId?: string
}

export const LOCAL_RPC_CALLER_KEY = 'local'

export function rpcCallerKey(caller: RpcCaller): string {
  return caller.pairedDeviceId ?? caller.clientId ?? LOCAL_RPC_CALLER_KEY
}
