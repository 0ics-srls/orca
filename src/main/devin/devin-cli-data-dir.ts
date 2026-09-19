import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAbsoluteDirOverride } from '../../shared/absolute-dir-override'

// DEVIN_HOME overrides the root containing credentials.toml and the cli directory.
export function resolveDevinCliDataDir(): string {
  const platformDataDir =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : process.env.XDG_DATA_HOME
  const resolvedPlatformDataDir = resolveAbsoluteDirOverride(
    platformDataDir,
    process.platform === 'win32'
      ? join(homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : join(homedir(), '.local', 'share')
  )
  return join(
    resolveAbsoluteDirOverride(process.env.DEVIN_HOME, join(resolvedPlatformDataDir, 'devin')),
    'cli'
  )
}

export function resolveDevinTranscriptsDir(): string {
  return join(resolveDevinCliDataDir(), 'transcripts')
}
