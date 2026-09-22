import { RuntimeClientError } from './types'

export const RUNTIME_ACCESS_DENIED_CODE = 'runtime_access_denied'

// Why: the errno decides the classification; CODEX_SANDBOX only picks the wording.
export function runtimeAccessDeniedError(socketError: unknown): RuntimeClientError | null {
  const systemCode =
    socketError !== null && typeof socketError === 'object' && 'code' in socketError
      ? socketError.code
      : null
  if (systemCode !== 'EPERM' && systemCode !== 'EACCES') {
    return null
  }
  const codexSandbox = Boolean(process.env.CODEX_SANDBOX)
  const message = codexSandbox
    ? `The Codex sandbox blocked this command from connecting to Orca (${systemCode}). Orca may be running normally.`
    : `Permission denied connecting to Orca (${systemCode}). Orca may be running normally; this command's sandbox or OS permissions block the connection.`
  const retryStep = codexSandbox
    ? 'Re-run this command with escalated permissions, outside the Codex sandbox.'
    : 'Re-run this command outside its sandbox, or as a user allowed to reach the Orca runtime.'
  return new RuntimeClientError(RUNTIME_ACCESS_DENIED_CODE, message, {
    systemCode,
    nextSteps: [
      retryStep,
      "Do not restart Orca or run 'orca open'; a restart cannot grant this command access."
    ]
  })
}
