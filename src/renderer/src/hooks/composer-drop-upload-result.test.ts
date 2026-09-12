import { describe, expect, it } from 'vitest'
import {
  collectComposerDropUploadResult,
  shouldReportComposerDropUploadFailure,
  type ComposerDropUploadImportResult
} from './composer-drop-upload-result'

describe('composer drop upload result', () => {
  it('separates imported files and folders while counting skipped or failed paths', () => {
    const results: ComposerDropUploadImportResult[] = [
      { status: 'imported', kind: 'file', destPath: '/repo/.orca/drops/file.txt' },
      { status: 'imported', kind: 'directory', destPath: '/repo/.orca/drops/folder' },
      { status: 'skipped', reason: 'permission-denied' },
      { status: 'failed', reason: 'disk full' }
    ]

    expect(collectComposerDropUploadResult(results)).toEqual({
      filePaths: ['/repo/.orca/drops/file.txt'],
      folderPaths: ['/repo/.orca/drops/folder'],
      skippedOrFailed: 2,
      // Why undefined: the two non-imported entries disagree, so no single reason explains the count.
      uniformFailure: undefined
    })
  })

  it('reports no first failure when every path imported', () => {
    expect(
      collectComposerDropUploadResult([
        { status: 'imported', kind: 'file', destPath: '/repo/.orca/drops/file.txt' }
      ]).uniformFailure
    ).toBeUndefined()
  })

  it('suppresses failed-upload reporting after a composer loses drop ownership', () => {
    const uploadResult = { skippedOrFailed: 1 }

    expect(shouldReportComposerDropUploadFailure(uploadResult, () => true)).toBe(true)
    expect(shouldReportComposerDropUploadFailure(uploadResult, () => false)).toBe(false)
    expect(shouldReportComposerDropUploadFailure({ skippedOrFailed: 0 }, () => true)).toBe(false)
  })
})
