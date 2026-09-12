/**
 * Hand-copied from `ImportSkipReason` (`src/main/ipc/filesystem-import-result-types.ts`); the
 * renderer cannot import that path under `config/tsconfig.web.json`. Nothing type-links the two, so
 * adding a member there will NOT fail the build here — an unrecognised reason simply renders no
 * detail, which is the correct degradation per `docs/reference/remote-wire-compatibility.md`.
 */
export type ComposerDropSkipReason = 'missing' | 'symlink' | 'permission-denied' | 'unsupported'

export type ComposerDropUploadImportResult =
  | {
      status: 'imported'
      destPath: string
      kind: 'file' | 'directory'
    }
  // Why split: the runtime import client reports a closed enum for a skip and free text for a
  // failure. Collapsing them would erase the union and let an unmapped token reach the UI.
  | {
      status: 'skipped'
      reason: ComposerDropSkipReason
    }
  | {
      status: 'failed'
      reason?: string
    }

export type ComposerDropUploadResult = {
  filePaths: string[]
  folderPaths: string[]
  skippedOrFailed: number
  /**
   * Set only when EVERY non-imported entry agrees on status and reason. A description sitting under
   * an aggregate count reads as the explanation for all of it, so a mixed batch gets no reason
   * rather than one item's reason presented as the whole story.
   */
  uniformFailure?: ComposerDropFailure
}

export type ComposerDropFailure = Exclude<ComposerDropUploadImportResult, { status: 'imported' }>

export function collectComposerDropUploadResult(
  results: readonly ComposerDropUploadImportResult[]
): ComposerDropUploadResult {
  const filePaths: string[] = []
  const folderPaths: string[] = []
  let skippedOrFailed = 0
  let uniformFailure: ComposerDropFailure | undefined
  let failureVaries = false

  for (const result of results) {
    if (result.status !== 'imported') {
      skippedOrFailed += 1
      if (!uniformFailure) {
        uniformFailure = result
      } else if (
        uniformFailure.status !== result.status ||
        uniformFailure.reason !== result.reason
      ) {
        failureVaries = true
      }
      continue
    }
    if (result.kind === 'directory') {
      folderPaths.push(result.destPath)
    } else {
      filePaths.push(result.destPath)
    }
  }

  return {
    filePaths,
    folderPaths,
    skippedOrFailed,
    uniformFailure: failureVaries ? undefined : uniformFailure
  }
}

export function shouldReportComposerDropUploadFailure(
  uploadResult: Pick<ComposerDropUploadResult, 'skippedOrFailed'>,
  canReport: () => boolean
): boolean {
  return uploadResult.skippedOrFailed > 0 && canReport()
}
