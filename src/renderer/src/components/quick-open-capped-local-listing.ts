/** Last capped local listing; name filters re-list such workspaces on the host. */
export type CappedLocalListing = { key: string; files: string[]; hostFilterFailed: boolean }

export function nextCappedLocalListing(
  current: CappedLocalListing | null,
  key: string,
  result: { files: string[]; truncated: boolean }
): CappedLocalListing | null {
  if (!result.truncated) {
    return null
  }
  // Why: a failed host filter stays failed so re-listing the same workspace does not retry it.
  return {
    key,
    files: result.files,
    hostFilterFailed: current?.key === key && current.hostFilterFailed
  }
}
