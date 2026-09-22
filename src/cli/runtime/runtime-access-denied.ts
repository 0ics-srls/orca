import { RuntimeClientError } from './types'

export const RUNTIME_ACCESS_DENIED_CODE = 'runtime_access_denied'

export type RuntimeAccessOperation = 'read_metadata' | 'connect'

const OPERATION_DESCRIPTION: Record<RuntimeAccessOperation, string> = {
  read_metadata: 'reading the Orca runtime metadata',
  connect: 'connecting to the Orca runtime'
}

const DO_NOT_RESTART_STEP =
  "Do not restart Orca or run 'orca open': the denial is on this command's side, so a restart cannot grant it access."

/** EPERM/EACCES from the metadata read or the socket/pipe connect. */
export function accessDeniedSystemCode(error: unknown): 'EPERM' | 'EACCES' | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return null
  }
  return error.code === 'EPERM' || error.code === 'EACCES' ? error.code : null
}

export function isRuntimeAccessDeniedError(error: unknown): error is RuntimeClientError {
  return error instanceof RuntimeClientError && error.code === RUNTIME_ACCESS_DENIED_CODE
}

// Why: the errno decides the classification; CODEX_SANDBOX only picks the wording.
export function runtimeAccessDeniedError(
  operation: RuntimeAccessOperation,
  systemCode: 'EPERM' | 'EACCES',
  pid?: number | null
): RuntimeClientError {
  const codexSandbox = process.env.CODEX_SANDBOX || null
  const what = `${OPERATION_DESCRIPTION[operation]} (${systemCode})`
  const message = codexSandbox
    ? `The Codex sandbox denied this command access while ${what}. Orca may be running normally; the sandbox blocks the connection.`
    : `Permission denied while ${what}. This command's sandbox or OS permissions block access; Orca may be running normally.`
  const retryStep = codexSandbox
    ? 'Re-run this command with escalated permissions, outside the Codex sandbox.'
    : 'Re-run this command outside its sandbox, or as a user allowed to reach the Orca runtime.'
  return new RuntimeClientError(RUNTIME_ACCESS_DENIED_CODE, message, {
    operation,
    systemCode,
    processState: 'unverifiable',
    retryable: false,
    ...(codexSandbox ? { codexSandbox } : {}),
    // The metadata pid is a hint; the denial means it was never verified.
    ...(typeof pid === 'number' ? { pid } : {}),
    nextSteps: [retryStep, DO_NOT_RESTART_STEP]
  })
}
