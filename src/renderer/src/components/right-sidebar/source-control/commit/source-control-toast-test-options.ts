export type SourceControlToastTestOptions = {
  id?: string
  description?: string
  duration?: number
  action?: { label: string; onClick: () => void }
}
