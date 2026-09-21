import { opendirSync, type Dir } from 'node:fs'

/** `denied` is the only outcome that proves a permission refusal; `other` keeps unknown errors apart. */
export type DirectoryEnumerationOutcome = 'ok' | 'denied' | 'missing' | 'other'

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  const { code } = error
  return typeof code === 'string' ? code : undefined
}

/**
 * Why enumeration and not `access()`: macOS TCC can let `access(R_OK|X_OK)` succeed on a protected
 * folder while `opendir` still fails, which is exactly what a shell listing its cwd hits. One entry
 * is enough — the refusal lands on `opendir` or the first read, never later.
 */
export function enumerateDirectoryOnce(path: string): DirectoryEnumerationOutcome {
  let dir: Dir | undefined
  try {
    dir = opendirSync(path)
    dir.readSync()
    return 'ok'
  } catch (error) {
    const code = errorCode(error)
    if (code === 'EPERM' || code === 'EACCES') {
      return 'denied'
    }
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'other'
  } finally {
    try {
      dir?.closeSync()
    } catch {
      // A handle we cannot close says nothing about readability.
    }
  }
}
