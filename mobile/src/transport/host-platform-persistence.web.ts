// Web sibling: the page keeps the platform in memory only. Its storage grant is an allowlist, and a
// key only the header reads is not page state worth admitting; the page's own status read refills it.
export const readPersistedHostPlatform = (_hostId: string): Promise<NodeJS.Platform | null> =>
  Promise.resolve(null)

export const writePersistedHostPlatform = (
  _hostId: string,
  _platform: NodeJS.Platform | null
): Promise<void> => Promise.resolve()
