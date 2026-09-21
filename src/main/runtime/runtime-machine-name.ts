import os from 'node:os'
import { runProcess } from '../../shared/child-process/run-process'

const MACOS_COMPUTER_NAME = '/usr/sbin/scutil'
const MACOS_COMPUTER_NAME_TIMEOUT_MS = 1_000
const MACOS_COMPUTER_NAME_MAX_OUTPUT_BYTES = 4 * 1024

type MachineNameReader = () => string | undefined

export async function detectRuntimeMachineName(
  args: {
    platform?: NodeJS.Platform
    fallback?: string
    run?: typeof runProcess
  } = {}
): Promise<string> {
  const platform = args.platform ?? process.platform
  const fallback = normalizeMachineName(args.fallback ?? os.hostname())
  if (platform !== 'darwin') {
    return fallback
  }
  try {
    const result = await (args.run ?? runProcess)({
      program: MACOS_COMPUTER_NAME,
      args: ['--get', 'ComputerName'],
      timeoutMs: MACOS_COMPUTER_NAME_TIMEOUT_MS,
      maxOutputBytes: MACOS_COMPUTER_NAME_MAX_OUTPUT_BYTES,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
    })
    if (result.code === 0 && !result.timedOut) {
      const friendlyName = normalizeMachineName(result.stdout)
      if (friendlyName) {
        return friendlyName
      }
    }
  } catch {
    // Restricted or older macOS installs fall back to the hostname.
  }
  return fallback
}

export class RuntimeMachineName {
  private detectedName = normalizeMachineName(os.hostname())
  private started = false

  constructor(private readonly readConfiguredName: MachineNameReader) {}

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    void detectRuntimeMachineName().then((name) => {
      this.detectedName = name
    })
  }

  read(): string {
    return normalizeMachineName(this.readConfiguredName()) || this.detectedName
  }
}

function normalizeMachineName(value: string | undefined): string {
  return value?.trim() ?? ''
}
