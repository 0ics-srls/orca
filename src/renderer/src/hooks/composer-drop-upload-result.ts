import type { ImportSkipReason } from '@/runtime/runtime-file-client'

export type ComposerDropUploadImportResult =
  | {
      status: 'imported'
      destPath: string
      kind: 'file' | 'directory'
    }
  | {
      status: 'skipped'
      reason: ImportSkipReason
    }
  | {
      status: 'failed'
      reason?: string
    }

export type ComposerDropUploadResult = {
  filePaths: string[]
  folderPaths: string[]
  skippedOrFailed: number
  /** Included only when one explanation applies to every failed item. */
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
