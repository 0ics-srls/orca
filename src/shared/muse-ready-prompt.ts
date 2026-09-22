/** Index of the latest Muse composer, or null when that screen is not showing. */
export function findMuseReadyPromptIndex(normalized: string): number | null {
  const bannerIndex = normalized.lastIndexOf('muse code')
  if (bannerIndex === -1) {
    return null
  }
  return normalized.includes('❯', bannerIndex) ? bannerIndex : null
}
