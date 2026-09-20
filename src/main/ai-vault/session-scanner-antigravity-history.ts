import type { AiVaultSession } from '../../shared/ai-vault-types'
import { wslGatedReadFile } from '../native-chat/wsl-transcript-fs-access'
import { WslTranscriptFsError } from '../native-chat/wsl-transcript-fs-gate'
import { dirname, join } from 'node:path'
import { normalizeTitleText, parseJsonObject, timestampMs } from './session-scanner-values'

const HISTORY_MATCH_WINDOW_MS = 2_000

/**
 * The local-scan `readHistory`; remote scans inject their own transport. A
 * missing or unreadable history file is genuinely "no enrichment", but a gate
 * refusal must propagate so the caller records a scan issue — degrading it to
 * null lists the session with a missing cwd and no retry signal, and the
 * resolver's memo relies on the rejection to evict rather than pin a stall.
 */
export async function readLocalAntigravityHistory(path: string): Promise<string | null> {
  try {
    const history = await wslGatedReadFile(path, 'utf-8', 'scan')
    return history
  } catch (error) {
    if (error instanceof WslTranscriptFsError) {
      throw error
    }
    return readAntigravityCacheHistory(path)
  }
}

/**
 * Newer agy builds keep IDE conversation metadata in cache instead of history.jsonl.
 * Join only IDs, timestamps, and project paths; conversation databases remain opaque.
 */
async function readAntigravityCacheHistory(historyPath: string): Promise<string | null> {
  const cliRoot = dirname(historyPath)
  try {
    const [metadataText, projectsText, lastConversationsText] = await Promise.all([
      wslGatedReadFile(join(cliRoot, 'cache', 'conversation_metadata.json'), 'utf-8', 'scan'),
      readOptionalCacheFile(join(cliRoot, 'cache', 'projects.json')),
      readOptionalCacheFile(join(cliRoot, 'cache', 'last_conversations.json'))
    ])
    const metadata = JSON.parse(metadataText)
    const projects = projectsText ? JSON.parse(projectsText) : null
    const lastConversations = lastConversationsText ? JSON.parse(lastConversationsText) : null
    if (!isRecord(metadata)) {
      return null
    }
    const conversations = isRecord(metadata.conversations) ? metadata.conversations : null
    if (!conversations) {
      return null
    }
    const projectPaths = new Map<string, string>()
    if (isRecord(projects)) {
      for (const [key, value] of Object.entries(projects)) {
        if (typeof value !== 'string' || !key.trim()) {
          continue
        }
        // agy has emitted both { workspace: projectId } and { projectId: workspace }.
        if (key.includes('/') || key.includes('\\')) {
          projectPaths.set(value, key)
        } else if (value.includes('/') || value.includes('\\')) {
          projectPaths.set(key, value)
        }
      }
    }
    const conversationPaths = new Map<string, string>()
    if (isRecord(lastConversations)) {
      for (const [workspace, conversationId] of Object.entries(lastConversations)) {
        if (typeof conversationId === 'string' && workspace.trim()) {
          conversationPaths.set(conversationId, workspace)
        }
      }
    }
    const rows: string[] = []
    for (const [conversationId, value] of Object.entries(conversations)) {
      if (!isRecord(value) || !isRecord(value.summary)) {
        continue
      }
      const summary = value.summary
      const projectId = typeof summary.ProjectID === 'string' ? summary.ProjectID : ''
      const workspace = projectPaths.get(projectId) ?? conversationPaths.get(conversationId)
      const updatedAt = typeof summary.UpdatedAt === 'string' ? summary.UpdatedAt : ''
      if (!workspace || !conversationId || !Number.isFinite(Date.parse(updatedAt))) {
        continue
      }
      rows.push(JSON.stringify({ conversationId, timestamp: updatedAt, workspace }))
    }
    return rows.length > 0 ? `${rows.join('\n')}\n` : null
  } catch (error) {
    if (error instanceof WslTranscriptFsError) {
      throw error
    }
    return null
  }
}

async function readOptionalCacheFile(path: string): Promise<string | null> {
  try {
    return await wslGatedReadFile(path, 'utf-8', 'scan')
  } catch (error) {
    if (error instanceof WslTranscriptFsError) {
      throw error
    }
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type AntigravityHistoryEntry = {
  timestampMs: number
  workspace: string
}

type AntigravityHistoryIndex = {
  byConversationId: Map<string, AntigravityHistoryEntry>
  byDisplay: Map<string, AntigravityHistoryEntry[]>
}

export type AntigravityWorkspaceResolver = {
  enrich(session: AiVaultSession, historyPath: string): Promise<AiVaultSession>
}

export function createAntigravityWorkspaceResolver(
  readHistory: (historyPath: string) => Promise<string | null>
): AntigravityWorkspaceResolver {
  const indexes = new Map<string, Promise<AntigravityHistoryIndex>>()

  return {
    async enrich(session, historyPath) {
      if (session.agent !== 'antigravity' || session.cwd) {
        return session
      }
      let index = indexes.get(historyPath)
      if (!index) {
        // Why: a read failure is transient (a stalled WSL distro refuses here),
        // so it must not be memoized — every later session under this history
        // file would inherit the rejection for the process lifetime.
        const pending: Promise<AntigravityHistoryIndex> = readHistory(historyPath)
          .then(indexAntigravityHistory)
          .catch((error: unknown) => {
            if (indexes.get(historyPath) === pending) {
              indexes.delete(historyPath)
            }
            throw error
          })
        index = pending
        indexes.set(historyPath, pending)
      }
      const workspace = findAntigravityWorkspace(session, await index)
      return workspace ? { ...session, cwd: workspace } : session
    }
  }
}

function indexAntigravityHistory(content: string | null): AntigravityHistoryIndex {
  const index: AntigravityHistoryIndex = {
    byConversationId: new Map(),
    byDisplay: new Map()
  }
  for (const line of content?.split(/\r?\n/) ?? []) {
    const record = parseJsonObject(line)
    const display = typeof record?.display === 'string' ? normalizeTitleText(record.display) : null
    const workspace = typeof record?.workspace === 'string' ? record.workspace.trim() : ''
    const conversationId =
      typeof record?.conversationId === 'string' ? record.conversationId.trim() : ''
    const entryTimestampMs = timestampMs(record?.timestamp)
    if (!workspace || !Number.isFinite(entryTimestampMs)) {
      continue
    }
    const entry = { timestampMs: entryTimestampMs, workspace }
    const directEntry = index.byConversationId.get(conversationId)
    if (conversationId && (!directEntry || entryTimestampMs < directEntry.timestampMs)) {
      index.byConversationId.set(conversationId, entry)
    }
    // An explicit conversation ID must never become another session's prompt fallback.
    if (conversationId || !display) {
      continue
    }
    const entries = index.byDisplay.get(display) ?? []
    entries.push(entry)
    index.byDisplay.set(display, entries)
  }
  return index
}

function findAntigravityWorkspace(
  session: AiVaultSession,
  index: AntigravityHistoryIndex
): string | null {
  const directMatch = index.byConversationId.get(session.sessionId)
  if (directMatch) {
    return directMatch.workspace
  }
  // Why: truncated titles are not prompt identities; long worker prompts often
  // share the same 96-character prefix across unrelated workspaces.
  if (session.title.endsWith('...')) {
    return null
  }
  const firstTitledUserTimestamp = session.previewMessages.find(
    (message) => message.role === 'user' && normalizeTitleText(message.text) === session.title
  )?.timestamp
  const promptTimestampMs = timestampMs(firstTitledUserTimestamp ?? session.createdAt)
  if (!Number.isFinite(promptTimestampMs)) {
    return null
  }
  const matches = (index.byDisplay.get(session.title) ?? []).filter(
    (entry) => Math.abs(entry.timestampMs - promptTimestampMs) <= HISTORY_MATCH_WINDOW_MS
  )
  // Why: legacy history rows have no conversation id. A unique prompt/time
  // match is evidence for cwd; ambiguity must stay unknown instead of crossing projects.
  return matches.length === 1 ? (matches[0]?.workspace ?? null) : null
}
