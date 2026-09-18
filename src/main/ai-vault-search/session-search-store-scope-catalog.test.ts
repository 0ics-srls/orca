import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { sessionSearchScopeCatalogFromStore } from './session-search-store-scope-catalog'

const REPOS = [
  { id: 'local-repo', path: '/work/app', addedAt: 0, displayName: 'app', badgeColor: '#000' },
  {
    id: 'ssh-repo',
    path: '/srv/app',
    connectionId: 'box',
    addedAt: 0,
    displayName: 'app',
    badgeColor: '#000'
  }
] satisfies Repo[]

function store() {
  return {
    getRepos: () => [...REPOS],
    getProjects: () => [{ id: 'proj-1', sourceRepoIds: ['local-repo'] }],
    getProjectHostSetups: () => [
      { id: 's1', projectId: 'proj-1', hostId: 'local', repoId: 'local-repo', path: '/work/app' },
      { id: 's2', projectId: 'proj-1', hostId: 'ssh:box', repoId: 'ssh-repo', path: '/srv/app' }
    ],
    getAllWorktreeMeta: () => ({
      'local-repo::/work/one': { hostId: 'local' },
      'ssh-repo::/srv/one': { hostId: 'ssh:box' }
    }),
    getSettings: () => ({ workspaceDir: '/home/me/orca/workspaces', nestWorkspaces: true })
  }
}

describe('scope catalog from the profile store', () => {
  it('keeps only the rows the addressed execution host owns', () => {
    const local = sessionSearchScopeCatalogFromStore(store(), 'local')
    expect(local.repos.map((repo) => repo.id)).toEqual(['local-repo'])
    expect(local.projectHostSetups.map((setup) => setup.repoId)).toEqual(['local-repo'])
    expect(Object.keys(local.worktreeMeta)).toEqual(['local-repo::/work/one'])
  })

  it('answers for an SSH host from that host’s own rows, not the desktop’s', () => {
    const remote = sessionSearchScopeCatalogFromStore(store(), 'ssh:box')
    expect(remote.repos.map((repo) => repo.id)).toEqual(['ssh-repo'])
    expect(Object.keys(remote.worktreeMeta)).toEqual(['ssh-repo::/srv/one'])
  })

  it('carries the placement settings a managed worktree directory is derived from', () => {
    expect(sessionSearchScopeCatalogFromStore(store(), 'local').settings).toEqual({
      workspaceDir: '/home/me/orca/workspaces',
      nestWorkspaces: true
    })
  })
})
