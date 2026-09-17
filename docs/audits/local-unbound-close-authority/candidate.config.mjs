import base from '../../../config/vitest.config.ts'
import { resolve } from 'node:path'
const helper = JSON.stringify(resolve('docs/audits/local-unbound-close-authority/candidate.ts'))
const receipt = process.env.ORCA_UNBOUND_RECEIPT === '1'
const consumer = receipt
  ? JSON.stringify(resolve('docs/audits/local-unbound-close-authority/receipt-candidate.ts'))
  : helper
export default {
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'unbound-close-prototype',
      enforce: 'pre',
      transform(source, id) {
        if (process.env.ORCA_UNBOUND_CANDIDATE !== '1') {
          return null
        }
        if (receipt && id.endsWith('/src/shared/terminal-tab-types.ts')) {
          return source.replace(
            '  generation?: number',
            '  generation?: number\n  rejectedLocalTabCloseAt?: number'
          )
        }
        if (receipt && id.endsWith('/src/shared/workspace-session-schema.ts')) {
          return source.replace(
            '  generation: z.number().optional(),',
            '  generation: z.number().optional(),\n  rejectedLocalTabCloseAt: z.number().int().nonnegative().optional(),'
          )
        }
        if (id.endsWith('/src/shared/closed-terminal-tab-tombstones.ts')) {
          return source
            .replace(
              '  ackRevision?: number',
              '  ackRevision?: number\n  unboundLocalTab?: { createdAt: number; generation: number }'
            )
            .replace(
              '  ackRevision: z.number()',
              '  unboundLocalTab: z.object({createdAt: z.number(), generation: z.number()}).optional(),\n  ackRevision: z.number()'
            )
        }
        if (id.endsWith('/src/renderer/src/store/terminals/terminal-tab-close.ts')) {
          return `import { unboundIdentity } from ${helper}\nimport { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'\n${source
            .replace(
              '        const nextClosedTombstones =',
              `        const localIdentity = closedWorktreeId && retirementPlan.ptyIds.length === 0 && getConnectionIdFromState(s, closedWorktreeId) === null && getExecutionHostIdForWorktree(s, closedWorktreeId) === 'local' ? unboundIdentity(s, closedWorktreeId, tabId) : undefined\n        let nextClosedTombstones =`
            )
            .replace(
              '        // Why: only explicit user closes',
              `        if (closeReason === 'user' && localIdentity && closedWorktreeId) {\n          nextClosedTombstones = { ...recordClosedTerminalTabTombstone(s.closedTerminalTabTombstonesByTabId, tabId, closedWorktreeId, Date.now()), [tabId]: { closedAt: Date.now(), worktreeId: closedWorktreeId, unboundLocalTab: localIdentity } }\n        }\n        // Why: only explicit user closes`
            )}`
        }
        if (
          id.endsWith(
            '/src/main/persistence/loading-store/workspace-session-snapshot-publication.ts'
          )
        ) {
          return `import { applyUnboundCloses } from ${consumer}\n${source.replace(
            '  session = sanitizeWorkspaceSessionTerminalRetirements(session, prior)',
            '  session = applyUnboundCloses(session, prior, context.runtime.state)\n  session = sanitizeWorkspaceSessionTerminalRetirements(session, prior)'
          )}`
        }
        if (id.endsWith('/src/main/persistence/loading-store/terminal-session-cleanup.ts')) {
          return source.replace(
            "  'tabsByWorktree',",
            "  'closedTerminalTabTombstonesByTabId',\n  'tabsByWorktree',"
          )
        }
        return null
      }
    }
  ],
  test: {
    ...base.test,
    include: ['docs/audits/local-unbound-close-authority/ownership.test.ts'],
    maxWorkers: 1,
    fileParallelism: false
  }
}
