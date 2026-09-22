export function isMuseReadyPromptPreview(preview: string): boolean {
  const normalized = preview.toLowerCase()
  const index = normalized.lastIndexOf('muse code')
  const segment = index === -1 ? '' : normalized.slice(index)
  return (
    index !== -1 &&
    segment.includes('skills:') &&
    segment.includes('loaded') &&
    segment.includes('❯')
  )
}
