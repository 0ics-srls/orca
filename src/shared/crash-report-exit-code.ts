import { decodePosixWaitStatus, describePosixWaitStatus } from './posix-wait-status'
import { decodeWindowsCrashExitCode, describeWindowsCrashExitCode } from './windows-crash-exit-code'

type CrashReportExitCode = {
  exitCode: number | null
  platform: NodeJS.Platform
  reason: string
}

/**
 * The platform meaning of an exit code, or null when it has none worth showing:
 * "exit status 241", "SIGKILL", "0xFFFF7001, crash handler unreachable; client
 * self-terminated without a minidump". Every caller that renders a decoded exit
 * code goes through here, so the report text and the span attribute cannot drift.
 * launch-failed codes are neither wait statuses nor Windows status codes.
 */
export function describeCrashReportExitCode(report: CrashReportExitCode): string | null {
  if (report.exitCode === null || report.exitCode === undefined) {
    return null
  }
  if (report.reason === 'launch-failed') {
    return null
  }
  if (report.platform === 'win32') {
    const windowsDecoded = decodeWindowsCrashExitCode(report.exitCode)
    return windowsDecoded ? describeWindowsCrashExitCode(windowsDecoded) : null
  }
  const decoded = decodePosixWaitStatus(report.exitCode)
  // A clean exit(0) decodes to itself; the suffix would only add noise.
  if (!decoded || (decoded.kind === 'exited' && report.exitCode === 0)) {
    return null
  }
  return describePosixWaitStatus(decoded)
}

/** Renders the raw exit code first, then its meaning in parentheses if it has one. */
export function formatCrashReportExitCode(report: CrashReportExitCode): string {
  if (report.exitCode === null || report.exitCode === undefined) {
    return 'unknown'
  }
  const described = describeCrashReportExitCode(report)
  return described === null ? String(report.exitCode) : `${report.exitCode} (${described})`
}
