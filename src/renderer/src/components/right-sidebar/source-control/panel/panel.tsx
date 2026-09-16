import { translate } from '@/i18n/i18n'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { isFolderRepo } from '../../../../../../shared/repo-kind'
import { SourceControlPanelReady } from './panel-ready'
import type { SourceControlPanelReadyProps } from './panel-props'
import { useSourceControlPanelModel } from './use-panel-model'

/** Keep Git hooks unmounted for workspaces that only display a placeholder. */
export function SourceControlPanel() {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const worktreePath = activeWorktree?.path

  if (!activeWorktree || !activeRepo || !worktreePath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
        {translate(
          'auto.components.right.sidebar.SourceControl.c07b236287',
          'Select a workspace to view changes'
        )}
      </div>
    )
  }
  if (isFolderRepo(activeRepo)) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
        {translate(
          'auto.components.right.sidebar.SourceControl.e131cd7128',
          'Source Control is only available for Git repositories'
        )}
      </div>
    )
  }

  return (
    <GitSourceControlPanel
      activeRepo={activeRepo}
      activeWorktree={activeWorktree}
      worktreePath={worktreePath}
    />
  )
}

function GitSourceControlPanel(
  props: Pick<SourceControlPanelReadyProps, 'activeRepo' | 'activeWorktree' | 'worktreePath'>
) {
  const model = useSourceControlPanelModel()
  return (
    <SourceControlPanelReady {...props} currentWorktreeId={props.activeWorktree.id} model={model} />
  )
}
