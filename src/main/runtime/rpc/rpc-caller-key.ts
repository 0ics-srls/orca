/**
 * The identity an RPC caller's durable state is filed under.
 *
 * One function because the alternative is four derivations that drift: an operation ledger, the
 * identity a launch commits, and a create dedupe key all have to agree on who the caller is, or a
 * retry from the same device reads as a different caller and starts a second agent.
 *
 * The order is the rule stated on `RpcContext`: key by the revocable device identity, never by the
 * bearer credential. `pairedDeviceId` survives a reconnect and dies when the pairing is revoked;
 * `clientId` is the device token, which is why it is only the fallback for a caller that has not
 * paired. An in-process caller is the host itself and shares one key.
 */

export type RpcCaller = {
  pairedDeviceId?: string
  clientId?: string
}

export const LOCAL_RPC_CALLER_KEY = 'local'

export function rpcCallerKey(caller: RpcCaller): string {
  return caller.pairedDeviceId ?? caller.clientId ?? LOCAL_RPC_CALLER_KEY
}
