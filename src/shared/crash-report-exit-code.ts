import { decodePosixWaitStatus, describePosixWaitStatus } from './posix-wait-status'
import { decodeWindowsCrashExitCode, describeWindowsCrashExitCode } from './windows-crash-exit-code'
import {
  decodeWindowsLaunchFailureCode,
  describeWindowsLaunchFailureCode
} from './windows-launch-failure-code'

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
 *
 * Three disjoint namespaces meet in one `exitCode` field, and which one applies is decided by
 * `reason`, not by the number: a launch-failed code names a Chromium launch stage (the process
 * never ran), while every other reason carries a real wait status or Windows status code. 18 is
 * SBOX_ERROR_CREATE_PROCESS under launch-failed and an ordinary `signal 18` under crashed.
 */
export function describeCrashReportExitCode(report: CrashReportExitCode): string | null {
  if (report.exitCode === null || report.exitCode === undefined) {
    return null
  }
  if (report.reason === 'launch-failed') {
    // A launch code is not an exit status: the process never ran. It has its own namespace,
    // so it must be decoded before the platform branch below and never fall through to it —
    // POSIX would read 18 as `signal 18`, and the Windows table would read 0xC0000005 as an
    // access violation, both confidently wrong for a launch that never started.
    // win32 only: Chromium reports a sandbox stage there, while darwin/linux can only ever
    // produce LAUNCH_RESULT_FAILURE, so naming a stage off-Windows would invent a cause.
    if (report.platform !== 'win32') {
      return null
    }
    const launchDecoded = decodeWindowsLaunchFailureCode(report.exitCode)
    return launchDecoded ? describeWindowsLaunchFailureCode(launchDecoded) : null
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
