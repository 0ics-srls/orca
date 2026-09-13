import type {
  AgentSessionFastModeSupport,
  AgentSessionModelOption,
  AgentSessionOptionChoice,
  AgentSessionOptionsResult
} from '../../shared/agent-session-wire'
import { CLAUDE_SESSION_OPTION_CATALOG } from '../../shared/agent-session-option-catalog-claude-codex'
import type { CatalogModel } from '../../shared/agent-session-option-catalog-types'
import type { ClaudeSession } from './claude-structured-session-state'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'

type ListedModel = AgentSessionModelOption & { resolvedModel: string | null }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The session's current effort, which only `get_settings` reports: the
 * `system/init` frame carries `model` but has never carried an effort of any
 * kind. Null when the provider stops reporting it, so the pill goes empty
 * rather than showing an effort nothing measured.
 */
export function readClaudeSettingsEffort(settings: unknown): string | null {
  return text(record(record(settings)?.effective)?.effortLevel)
}

export function readClaudeSettingsFastMode(settings: unknown): boolean | null {
  const value = record(record(settings)?.effective)?.fastMode
  return typeof value === 'boolean' ? value : null
}

export function readClaudeSettingsFastModePerSessionOptIn(settings: unknown): boolean | null {
  const value = record(record(settings)?.effective)?.fastModePerSessionOptIn
  return typeof value === 'boolean' ? value : null
}

const FAST_MODE_STATES = new Set(['off', 'cooldown', 'on'])

export function readClaudeFastModeFacts(value: unknown): {
  state?: NonNullable<ClaudeSession['fastModeState']>
  disabledReason?: string
  disabledReasonReported: boolean
} {
  const row = record(value)
  const state = text(row?.fast_mode_state)
  const reportedDisabledReason = text(row?.fast_mode_disabled_reason)
  return {
    ...(state && FAST_MODE_STATES.has(state)
      ? { state: state as NonNullable<ClaudeSession['fastModeState']> }
      : {}),
    ...(reportedDisabledReason ? { disabledReason: reportedDisabledReason } : {}),
    disabledReasonReported: Object.hasOwn(row ?? {}, 'fast_mode_disabled_reason')
  }
}

export function observeClaudeFastModeFacts(session: ClaudeSession, value: unknown): void {
  const facts = readClaudeFastModeFacts(value)
  if (facts.state) {
    session.fastModeState = facts.state
  }
  if (facts.disabledReason) {
    session.fastModeDisabledReason = facts.disabledReason
  } else if (facts.disabledReasonReported) {
    delete session.fastModeDisabledReason
  }
}

function effortLabel(value: string): string {
  return value === 'xhigh' ? 'Extra high' : `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function listedEfforts(row: Record<string, unknown>): AgentSessionOptionChoice[] {
  return row.supportsEffort === true && Array.isArray(row.supportedEffortLevels)
    ? row.supportedEffortLevels.flatMap((value) => {
        const effort = text(value)
        return effort ? [{ value: effort, label: effortLabel(effort) }] : []
      })
    : []
}

function listedModels(value: unknown): ListedModel[] {
  const response = record(value)
  const rows = Array.isArray(response?.models)
    ? response.models.map(record).filter((row): row is Record<string, unknown> => row !== null)
    : []
  const defaultRow = rows.find((row) => text(row.value) === 'default')
  const defaultResolvedModel = text(defaultRow?.resolvedModel)
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    const id = text(row.value)
    if (!id || id === 'default' || seen.has(id)) {
      return []
    }
    seen.add(id)
    const resolvedModel = text(row.resolvedModel)
    const description = text(row.description)
    const supportsFastMode =
      typeof row.supportsFastMode === 'boolean' ? row.supportsFastMode : undefined
    return [
      {
        id,
        label: text(row.displayName) ?? id,
        ...(description ? { description } : {}),
        isDefault: resolvedModel !== null && resolvedModel === defaultResolvedModel,
        efforts: listedEfforts(row),
        ...(supportsFastMode !== undefined ? { supportsFastMode } : {}),
        resolvedModel
      }
    ]
  })
}

function seedEfforts(model: CatalogModel): AgentSessionOptionChoice[] {
  const effort = model.options.find((option) => option.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.choices : []
}

function seedModels(): ListedModel[] {
  return CLAUDE_SESSION_OPTION_CATALOG.models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    isDefault: model.isDefault === true,
    efforts: seedEfforts(model),
    resolvedModel: null
  }))
}

function currentModelId(models: ListedModel[], reportedModel: string | undefined): string {
  const matched = reportedModel
    ? models.find(
        (model) =>
          model.id === reportedModel ||
          model.resolvedModel === reportedModel ||
          (reportedModel === 'default' && model.isDefault)
      )
    : undefined
  return (
    matched?.id ?? reportedModel ?? models.find((model) => model.isDefault)?.id ?? models[0]!.id
  )
}

/**
 * The model the session is running. A report the CLI made after the last write
 * outranks the write: it names the model the session ran. An older one does not
 * — a model set between turns has no report yet, and deferring to the previous
 * turn's would flip the pill back.
 *
 * Sole resolver of that question: every surface that acts on "the current model"
 * — the pill, the effort guard, the rejection it names — reads it here, so two
 * of them cannot answer it differently and offer an effort a third then refuses.
 */
export function readClaudeCurrentModel(session: ClaudeSession): {
  id: string | undefined
  confirmed: boolean
} {
  const confirmed =
    session.reportedModelMutation === session.optionMutationSequence &&
    session.reportedOptions.model !== undefined
  return {
    id: confirmed
      ? session.reportedOptions.model
      : (session.options.get('model') ?? session.reportedOptions.model),
    confirmed
  }
}

/**
 * The effort levels the session's current model advertises, with the catalog id
 * that matched so a refusal names the model the pill shows. Levels are null when
 * nothing identified the model: `apply_flag_settings` accepts and stores any
 * level for a model with no effort control, so the catalog is the only evidence
 * of a refusal — and an absent or unlisted one is not evidence, or a live CLI
 * that predates `list_models` would have every effort refused under it.
 */
export async function readClaudeModelEffortLevels(
  session: ClaudeSession,
  timeoutMs: number | undefined
): Promise<{ modelId: string | undefined; levels: ReadonlySet<string> | null }> {
  const modelId = readClaudeCurrentModel(session).id
  if (!modelId) {
    return { modelId, levels: null }
  }
  const catalog = await session.connection.supportedModels({ timeoutMs }).catch(() => null)
  const matched = catalog
    ? listedModels({ models: catalog }).find(
        (model) => model.id === modelId || model.resolvedModel === modelId
      )
    : undefined
  return {
    modelId: matched?.id ?? modelId,
    levels: matched ? new Set(matched.efforts.map((choice) => choice.value)) : null
  }
}

export async function readClaudeModelFastModeSupport(
  session: ClaudeSession,
  timeoutMs: number | undefined,
  requestedModel?: string
): Promise<{ modelId: string | undefined; supported: boolean | null }> {
  const reportedModelId = requestedModel ?? readClaudeCurrentModel(session).id
  const catalog = await session.connection.supportedModels({ timeoutMs }).catch(() => null)
  const models = catalog ? listedModels({ models: catalog }) : []
  const modelId = reportedModelId ?? models.find((model) => model.isDefault)?.id
  const matched = models.find(
    (model) =>
      model.id === modelId ||
      model.resolvedModel === modelId ||
      (modelId === 'default' && model.isDefault)
  )
  return {
    modelId: matched?.id ?? modelId,
    supported: matched?.supportsFastMode ?? null
  }
}

const TRANSIENT_FAST_MODE_REASONS = new Set(['network_error', 'unknown', 'pending'])
const NON_BLOCKING_FAST_MODE_REASONS = new Set(['preference', 'sdk_opt_in_required'])

function claudeFastModeSupport(
  models: readonly ListedModel[],
  disabledReason: string | undefined
): AgentSessionFastModeSupport | undefined {
  if (disabledReason && TRANSIENT_FAST_MODE_REASONS.has(disabledReason)) {
    return undefined
  }
  if (disabledReason && !NON_BLOCKING_FAST_MODE_REASONS.has(disabledReason)) {
    return { supported: false, reason: disabledReason }
  }
  if (!models.some((model) => model.supportsFastMode === true)) {
    return models.length > 0 && models.every((model) => model.supportsFastMode === false)
      ? { supported: false, reason: 'model-not-supported' }
      : undefined
  }
  return { supported: true }
}

function listedModelFastModeSupport(
  models: readonly ListedModel[],
  modelId: string
): boolean | undefined {
  return models.find(
    (model) =>
      model.id === modelId ||
      model.resolvedModel === modelId ||
      (modelId === 'default' && model.isDefault)
  )?.supportsFastMode
}

function decodedFastMode(session: ClaudeSession): boolean | undefined {
  const encoded = session.options.get('fastMode')
  if (encoded === undefined) {
    return undefined
  }
  const decoded = decodeStructuredAgentSessionOptionValue('fastMode', encoded)
  return typeof decoded === 'boolean' ? decoded : undefined
}

export async function readClaudeStructuredSessionOptions(
  session: ClaudeSession,
  timeoutMs: number | undefined
): Promise<AgentSessionOptionsResult> {
  const readMutationSequence = session.optionMutationSequence
  const [catalog, settings] = await Promise.all([
    session.connection.supportedModels({ timeoutMs }).catch(() => null),
    session.connection.getSettings({ timeoutMs }).catch(() => null)
  ])
  if (settings !== null && readMutationSequence === session.optionMutationSequence) {
    const effort = readClaudeSettingsEffort(settings)
    const fastMode = readClaudeSettingsFastMode(settings)
    const perSessionOptIn = readClaudeSettingsFastModePerSessionOptIn(settings)
    if (effort) {
      session.reportedOptions.effort = effort
    }
    if (fastMode !== null) {
      session.reportedOptions.fastMode = fastMode
      if (decodedFastMode(session) !== undefined) {
        session.options.set('fastMode', String(fastMode))
      }
      session.confirmedOptions.add('fastMode')
    }
    if (perSessionOptIn !== null) {
      session.fastModePerSessionOptIn = perSessionOptIn
    }
  }
  const discovered = listedModels(catalog ? { models: catalog } : null)
  const models = discovered.length > 0 ? discovered : seedModels()
  const current = readClaudeCurrentModel(session)
  const model = currentModelId(models, current.id)
  if (!models.some((entry) => entry.id === model)) {
    models.push({ id: model, label: model, isDefault: false, efforts: [], resolvedModel: null })
  }
  const effort = session.options.get('effort') ?? session.reportedOptions.effort
  let desiredFastMode = decodedFastMode(session)
  if (
    desiredFastMode === true &&
    listedModelFastModeSupport(discovered, model) === false &&
    readMutationSequence === session.optionMutationSequence
  ) {
    session.options.set('fastMode', 'false')
    session.confirmedOptions.delete('fastMode')
    desiredFastMode = false
  }
  const fastMode = desiredFastMode ?? session.reportedOptions.fastMode
  const support = claudeFastModeSupport(discovered, session.fastModeDisabledReason)
  const confirmed = [
    ...(current.confirmed ? ['model'] : []),
    ...(effort && session.confirmedOptions.has('effort') ? ['effort'] : []),
    ...(fastMode !== undefined &&
    (session.confirmedOptions.has('fastMode') || !session.options.has('fastMode'))
      ? ['fastMode']
      : [])
  ]
  return {
    models: models.map((entry) => ({
      id: entry.id,
      label: entry.label,
      ...(entry.description ? { description: entry.description } : {}),
      isDefault: entry.isDefault,
      efforts: entry.efforts,
      ...(entry.supportsFastMode !== undefined ? { supportsFastMode: entry.supportsFastMode } : {})
    })),
    ...(support ? { fastModeSupport: support } : {}),
    current: {
      model,
      ...(effort ? { effort } : {}),
      ...(fastMode !== undefined ? { fastMode } : {}),
      ...(session.fastModeState ? { fastModeState: session.fastModeState } : {}),
      ...(confirmed.length > 0 ? { confirmed } : {})
    }
  }
}
