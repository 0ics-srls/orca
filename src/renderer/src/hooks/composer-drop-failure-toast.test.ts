import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import { showComposerDropFailureToast } from './composer-drop-failure-toast'
import type { ImportSkipReason } from '@/runtime/runtime-file-client'

const SKIP_REASON_COPY: Record<ImportSkipReason, string> = {
  missing: 'No longer at its original path.',
  symlink: 'Symbolic links cannot be attached.',
  'permission-denied': 'Permission denied.',
  unsupported: 'Unsupported file type.'
}

function lastToast(): { title: string; description?: string } {
  const call = toastError.mock.calls.at(-1)
  return {
    title: String(call?.[0]),
    description: (call?.[1] as { description?: string })?.description
  }
}

describe('showComposerDropFailureToast', () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  it('stays neutral about the gesture, and pluralises like its namespace siblings', () => {
    showComposerDropFailureToast({ skippedOrFailed: 1, total: 1 })
    expect(lastToast().title).toBe('1 of 1 item could not be attached.')

    showComposerDropFailureToast({ skippedOrFailed: 2, total: 5 })
    expect(lastToast().title).toBe('2 of 5 items could not be attached.')
  })

  it("turns the import client's skip enum into copy instead of leaking the token", () => {
    const seen = new Map<string, string | undefined>()
    for (const reason of Object.keys(SKIP_REASON_COPY) as ImportSkipReason[]) {
      showComposerDropFailureToast({
        skippedOrFailed: 1,
        total: 3,
        uniformFailure: { status: 'skipped', reason }
      })
      seen.set(reason, lastToast().description)
    }
    expect(Object.fromEntries(seen)).toEqual(SKIP_REASON_COPY)
  })

  it('passes a free-form failure reason straight through', () => {
    showComposerDropFailureToast({
      skippedOrFailed: 2,
      total: 4,
      uniformFailure: { status: 'failed', reason: 'EACCES: permission denied' }
    })
    expect(lastToast().description).toBe('EACCES: permission denied')
  })

  it('shows no description when nothing explained the failure', () => {
    showComposerDropFailureToast({ skippedOrFailed: 1, total: 2 })
    expect(lastToast().description).toBeUndefined()
  })

  it('unwraps and clamps a host-minted failure reason before it reaches the row', () => {
    // Why: this reason is free text from the execution host — it can arrive IPC-wrapped and
    // multi-line, and a toast description is a single compact row.
    showComposerDropFailureToast({
      skippedOrFailed: 1,
      total: 2,
      uniformFailure: {
        status: 'failed',
        reason:
          "Error invoking remote method 'runtime:call': Error: EACCES: permission denied\nat Object.upload"
      }
    })
    expect(lastToast().description).toBe('EACCES: permission denied')
  })

  it('gives no reason at all when the batch failed for differing reasons', () => {
    // Why: a description under an aggregate count reads as the explanation for the whole count.
    showComposerDropFailureToast({ skippedOrFailed: 3, total: 6 })
    expect(lastToast().title).toBe('3 of 6 items could not be attached.')
    expect(lastToast().description).toBeUndefined()
  })
})
