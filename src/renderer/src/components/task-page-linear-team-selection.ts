import type { LinearTeam } from '../../../shared/linear/workspace-types'

/**
 * The persisted `defaultLinearTeamSelection` as the page may use it: a string
 * array, or null for sticky-all.
 *
 * Why: the value comes off disk or from a paired host and is not validated on
 * the way in; a string reached 1.4.207 and crashed page.tasks (0a2b6e7f).
 * Anything but an array of strings is read as sticky-all, never thrown on.
 */
export function storedLinearTeamSelection(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  return value.filter((id): id is string => typeof id === 'string')
}

export function reconcileLinearTeamSelection(
  availableTeams: LinearTeam[],
  storedSelection: unknown
): ReadonlySet<string> {
  const availableIds = availableTeams.map((team) => team.id)
  if (availableIds.length === 0) {
    return new Set()
  }

  const availableIdSet = new Set(availableIds)
  const validStoredSelection = (storedLinearTeamSelection(storedSelection) ?? []).filter((id) =>
    availableIdSet.has(id)
  )
  if (validStoredSelection.length > 0) {
    return new Set(validStoredSelection)
  }

  return new Set(availableIds)
}
