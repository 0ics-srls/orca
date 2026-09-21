// Shared state between the folder-access toast (which raises it) and the fix dialog (which renders
// it), so neither has to own the other. STA-7948.

import { create } from 'zustand'
import type { PtyManagementFolderAccessMismatch } from '../../../preload/api-types'

export const FOLDER_ACCESS_MISMATCH_NOTICE_ID = 'mac-daemon-folder-access-mismatch'

type MacFolderAccessFixState = {
  open: boolean
  mismatch: PtyManagementFolderAccessMismatch | null
  openFix: (mismatch: PtyManagementFolderAccessMismatch) => void
  close: () => void
  /** Carries a later poll's verdict into an open dialog so its first step can complete itself. */
  observeMismatch: (mismatch: PtyManagementFolderAccessMismatch | null) => void
}

export const useMacFolderAccessFixStore = create<MacFolderAccessFixState>()((set) => ({
  open: false,
  mismatch: null,
  openFix: (mismatch) => set({ open: true, mismatch }),
  close: () => set({ open: false }),
  observeMismatch: (mismatch) =>
    set((state) =>
      // Why the scope compare: a replacement daemon's denial is a different remedy, and the open
      // dialog must not silently retarget itself onto it.
      mismatch && state.mismatch?.daemonScope === mismatch.daemonScope ? { mismatch } : state
    )
}))
