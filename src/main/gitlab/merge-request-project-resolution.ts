import type { IssueSourcePreference } from '../../shared/repo-types'
import {
  getGlabKnownHosts,
  resolveIssueSource,
  type LocalGitExecOptions,
  type GitLabProjectRef
} from './gl-utils'

export async function withProjectRef<T>(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId: string | null | undefined,
  explicitProjectRef: GitLabProjectRef | null | undefined,
  fn: (projectRef: GitLabProjectRef, repoFlag: string) => Promise<T>,
  fallback: T,
  localGitOptions: LocalGitExecOptions = {}
): Promise<T> {
  const projectRef =
    explicitProjectRef ??
    (
      await resolveIssueSource(
        repoPath,
        preference,
        await getGlabKnownHosts(connectionId, localGitOptions),
        connectionId,
        localGitOptions
      )
    ).source
  if (!projectRef) {
    return fallback
  }
  return fn(projectRef, projectRef.path)
}
