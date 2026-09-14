import {
  agentHistoryMountAdapters,
  agentHistoryMountExposures
} from './agent-history-mount-adapters'
import { browserMountAdapters } from './browser-mount-adapters'
import { dictationMountAdapters } from './dictation-mount-adapters'
import { fileInventoryMountAdapters } from './file-inventory-mount-adapters'
import { hostedReviewMountAdapters } from './hosted-review-mount-adapters'
import { newTabAgentMountAdapters } from './new-tab-agent-mount-adapters'
import {
  pushRegistrationMountAdapters,
  pushRegistrationMountExposures
} from './push-registration-mount-adapters'
import { settingsMountAdapters, settingsMountExposures } from './settings-mount-adapters'
import { sourceControlMountAdapters } from './source-control-mount-adapters'
import { taskMountAdapters } from './task-mount-adapters'
import { taskWorkspaceHookMountAdapters } from './task-workspace-hook-mount-adapters'
import { taskWorkspaceSenderMountAdapters } from './task-workspace-sender-mount-adapters'
import { terminalMountAdapters } from './terminal-mount-adapters'
import { workspaceSettingsMounts } from './workspace-settings-mounts'
import type { MountedOperationModule } from '../mounted-operation-module'

/**
 * Every domain's mount adapters, paired with the file each one lives in. The register lives inside
 * the seam it registers, so adding a domain edits no engine file and moves no existing golden;
 * `adapter-seam.test.ts` checks each pairing names the file that declares it.
 */
export const MOUNTED_OPERATION_MODULES: readonly MountedOperationModule[] = [
  {
    source: 'agent-history-mount-adapters.ts',
    mounts: agentHistoryMountAdapters,
    exposes: agentHistoryMountExposures
  },
  { source: 'browser-mount-adapters.ts', mounts: browserMountAdapters },
  { source: 'dictation-mount-adapters.ts', mounts: dictationMountAdapters },
  { source: 'file-inventory-mount-adapters.ts', mounts: fileInventoryMountAdapters },
  { source: 'hosted-review-mount-adapters.ts', mounts: hostedReviewMountAdapters },
  { source: 'new-tab-agent-mount-adapters.ts', mounts: newTabAgentMountAdapters },
  {
    source: 'push-registration-mount-adapters.ts',
    mounts: pushRegistrationMountAdapters,
    exposes: pushRegistrationMountExposures
  },
  {
    source: 'settings-mount-adapters.ts',
    mounts: settingsMountAdapters,
    exposes: settingsMountExposures
  },
  { source: 'source-control-mount-adapters.ts', mounts: sourceControlMountAdapters },
  { source: 'task-mount-adapters.ts', mounts: taskMountAdapters },
  {
    source: 'task-workspace-hook-mount-adapters.ts',
    mounts: taskWorkspaceHookMountAdapters
  },
  {
    source: 'task-workspace-sender-mount-adapters.ts',
    mounts: taskWorkspaceSenderMountAdapters
  },
  { source: 'terminal-mount-adapters.ts', mounts: terminalMountAdapters },
  { source: 'workspace-settings-mounts.ts', mounts: workspaceSettingsMounts }
]
