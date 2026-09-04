import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type {
  ImportWarning,
  NormalizedToolStatus,
  ProductInstallationSummary,
  ToolCategory,
} from '../../shared/contracts.js'
import type {
  NormalizedSourceEvent,
  NormalizedToolEvent,
  ParsedSourceFile,
  SourceAdapter,
  SourceFile,
  SourceRecord,
} from './types.js'

const ADAPTER_VERSION = 'codex-rollout-jsonl-v5'
const SUPPORTED_VERSION = /^0\.152(?:\.|$)/
const RAW_SOURCE_WARNING =
  'Codex rollout JSONL is an undocumented local format. This adapter is version-gated and may require updates after Codex upgrades.'
const DISCOVERY_WARNING =
  `${RAW_SOURCE_WARNING} Product version is inferred from the newest observed session metadata.`

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asCommand = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ')
  return null
}
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const asBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null

type RawSourceRecord = Omit<SourceRecord, 'normalized'>

const emptyEvent = ({
  kind,
  actor,
  summary,
  correctionText = null,
}: {
  kind: string
  actor: NormalizedSourceEvent['actor']
  summary: string
  correctionText?: string | null
}): NormalizedSourceEvent => ({ kind, actor, summary, correctionText, tool: null, usage: null })

const extractMessage = (payload: Record<string, unknown>): string => {
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.flatMap((entry) => {
    const object = asObject(entry)
    const text = asString(object?.text)
    return text ? [text] : []
  }).join('\n')
}

const injectedBlockTags = [
  'recommended_plugins',
  'environment_context',
  'user_instructions',
  'skills_instructions',
  'permissions',
  'permissions_instructions',
  'collaboration_mode',
  'apps_instructions',
  'plugins_instructions',
  'runtime_info',
  'skill',
] as const

export const stripInjectedUserContent = (text: string): string => {
  let result = text
  for (const tag of injectedBlockTags) {
    result = result.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  result = result
    .replace(/# AGENTS\.md instructions\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ')
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ')
    .replace(/^# AGENTS\.md instructions[^\n]*$/gim, ' ')
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

export const normalizeCodexToolCategory = (rawName: string | null): ToolCategory => {
  const name = rawName?.toLocaleLowerCase().replaceAll('-', '_') ?? ''
  if (/^(?:command|command_execution|exec|exec_command|shell|bash)$/.test(name)) return 'terminal'
  if (/^(?:read|read_file|file_read)$/.test(name)) return 'file_read'
  if (/^(?:apply_patch|patch_apply|edit|write|write_file|file_change)$/.test(name)) return 'file_change'
  if (/^(?:search|grep|rg|find|glob)$/.test(name)) return 'search'
  if (/^(?:web|web_search|web_search_call)$/.test(name)) return 'web'
  if (/^(?:browser|computer|computer_use|preview)$/.test(name)) return 'browser'
  if (/^(?:subagent|sub_agent|collab_agent_tool_call|followup_task|interrupt_agent|list_agents|send_message|spawn_agent|wait_agent)$/.test(name)) return 'subagent'
  if (name.startsWith('mcp') || name.includes('__mcp__')) return 'mcp'
  return 'other'
}

const normalizedStatus = ({
  rawStatus,
  success,
  exitCode,
  output,
}: {
  rawStatus: string | null
  success?: boolean | null | undefined
  exitCode?: number | null | undefined
  output?: string | null | undefined
}): NormalizedToolStatus | null => {
  if (exitCode !== undefined && exitCode !== null) return exitCode === 0 ? 'success' : 'failure'
  if (success !== undefined && success !== null) return success ? 'success' : 'failure'
  const status = rawStatus?.toLocaleLowerCase() ?? ''
  if (['completed', 'complete', 'success', 'succeeded', 'ok'].includes(status)) return 'success'
  if (['failed', 'failure', 'error'].includes(status)) return 'failure'
  if (['rejected', 'denied', 'permission_rejected'].includes(status)) return 'rejected'
  if (['cancelled', 'canceled', 'aborted'].includes(status)) return 'cancelled'
  const result = output?.trim() ?? ''
  if (/^Rejected\(["']rejected by user["']\)$/i.test(result)) return 'rejected'
  if (/^(?:cancelled|canceled) by user$/i.test(result)) return 'cancelled'
  return null
}

const explicitDurationMs = (value: Record<string, unknown>): number | null => {
  const duration = asNumber(value.duration_ms)
  return duration !== null && duration >= 0 ? duration : null
}

const completedItemText = (item: Record<string, unknown>, fallback: string): string =>
  asString(item.text)
  ?? asString(item.summary)
  ?? asString(item.message)
  ?? asString(item.name)
  ?? fallback

const toolEvent = ({
  sourceInvocationId,
  phase,
  rawName,
  signature,
  rawStatus,
  success,
  exitCode,
  output,
  durationMs,
}: {
  sourceInvocationId: string
  phase: NormalizedToolEvent['phase']
  rawName: string | null
  signature: string | null
  rawStatus: string | null
  success?: boolean | null | undefined
  exitCode?: number | null | undefined
  output?: string | null | undefined
  durationMs: number | null
}): NormalizedToolEvent => ({
  sourceInvocationId,
  phase,
  category: normalizeCodexToolCategory(rawName),
  rawName,
  signature,
  status: normalizedStatus({ rawStatus, success, exitCode, output }),
  rawStatus,
  durationMs,
})

const normalizeCompletedItem = (
  item: Record<string, unknown>,
  fallbackInvocationId: string,
): NormalizedSourceEvent => {
  const itemType = asString(item.type) ?? 'unknown'
  const type = itemType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  const rawStatus = asString(item.status)
  if (type === 'user_message' || type === 'agent_message') {
    const actor = type === 'user_message' ? 'user' : 'agent'
    const summary = completedItemText(item, actor === 'user' ? 'User message' : 'Agent message')
    return emptyEvent({
      kind: actor === 'user' ? 'user_message_completed' : 'agent_message_completed',
      actor,
      summary,
      correctionText: actor === 'user' ? stripInjectedUserContent(summary) || null : null,
    })
  }
  if (type === 'reasoning') return emptyEvent({ kind: 'reasoning', actor: 'agent', summary: completedItemText(item, 'Reasoning event') })
  if (type === 'file_change' || type === 'extension') {
    return emptyEvent({ kind: type, actor: 'agent', summary: completedItemText(item, type.replaceAll('_', ' ')) })
  }
  if (type === 'sub_agent_activity' || type === 'collab_agent_tool_call') {
    return emptyEvent({ kind: 'subagent_activity', actor: 'agent', summary: completedItemText(item, 'Subagent activity') })
  }
  const toolTypes = new Set(['command_execution', 'dynamic_tool_call', 'function_call', 'mcp_tool_call', 'tool_call', 'web_search'])
  if (toolTypes.has(type)) {
    const sourceInvocationId = asString(item.id) ?? asString(item.call_id) ?? fallbackInvocationId
    const command = asCommand(item.command)
    const rawName = asString(item.name) ?? (type === 'command_execution' ? 'command' : type)
    const exitCode = asNumber(item.exit_code) ?? asNumber(item.exitCode)
    const status = normalizedStatus({ rawStatus, exitCode })
    return {
      kind: 'tool_completion',
      actor: 'tool',
      summary: command ?? `${rawName} ${status ?? rawStatus ?? 'completed'}`,
      correctionText: null,
      tool: toolEvent({
        sourceInvocationId,
        phase: 'completed',
        rawName,
        signature: command,
        rawStatus,
        exitCode,
        durationMs: explicitDurationMs(item),
      }),
      usage: null,
    }
  }
  return emptyEvent({ kind: 'item_completed', actor: 'system', summary: completedItemText(item, `${itemType} completed`) })
}

const normalizeRecord = (record: RawSourceRecord, usageCompatible: boolean): NormalizedSourceEvent => {
  const { payload } = record
  if (record.type === 'session_meta') return emptyEvent({ kind: 'session_meta', actor: 'system', summary: 'Session started' })
  if (record.type === 'turn_context') {
    const model = asString(payload.model)
    return emptyEvent({ kind: 'turn_context', actor: 'system', summary: model ? `Turn context: ${model}` : 'Turn context' })
  }
  if (record.type === 'response_item' && payload.type === 'message') {
    const role = asString(payload.role)
    const summary = extractMessage(payload) || 'Message'
    const actor = role === 'user' ? 'user' : role === 'assistant' ? 'agent' : 'system'
    return emptyEvent({
      kind: role === 'user' ? 'user_turn' : role === 'assistant' ? 'agent_turn' : 'system_message',
      actor,
      summary,
      correctionText: actor === 'user' ? stripInjectedUserContent(summary) || null : null,
    })
  }
  if (record.type === 'response_item') {
    const responseType = asString(payload.type) ?? 'response_item'
    if (responseType === 'reasoning') return normalizeCompletedItem(payload, `record:${record.sourcePointer}`)
    if (responseType === 'agent_message' || responseType === 'user_message') {
      const message = normalizeCompletedItem(payload, `record:${record.sourcePointer}`)
      return { ...message, kind: responseType === 'user_message' ? 'user_turn' : 'agent_turn' }
    }
    const sourceInvocationId = asString(payload.call_id) ?? asString(payload.id) ?? `record:${record.sourcePointer}`
    const output = asString(payload.output)
    const signature = asString(payload.arguments) ?? asString(payload.input)
    const isResult = responseType.endsWith('_output') || responseType.endsWith('_result')
    const isTool = isResult || responseType.endsWith('_call') || ['function_call', 'mcp_call', 'web_search_call'].includes(responseType)
    if (!isTool) return emptyEvent({ kind: 'response_item', actor: 'system', summary: completedItemText(payload, responseType) })
    const rawName = isResult ? null : asString(payload.name) ?? responseType.replace(/_(?:output|result)$/, '')
    const rawStatus = asString(payload.status)
    return {
      kind: isResult ? 'tool_result' : 'tool_call',
      actor: 'tool',
      summary: output ?? signature ?? rawName ?? responseType,
      correctionText: null,
      tool: toolEvent({
        sourceInvocationId,
        phase: isResult ? 'result' : 'request',
        rawName,
        signature,
        rawStatus: isResult ? rawStatus : null,
        output,
        durationMs: explicitDurationMs(payload),
      }),
      usage: null,
    }
  }
  if (record.type === 'event_msg') {
    const eventType = asString(payload.type) ?? 'event_msg'
    if (eventType === 'token_count') {
      const info = asObject(payload.info)
      const usage = asObject(info?.last_token_usage)
      return {
        ...emptyEvent({ kind: 'usage', actor: 'system', summary: 'Token usage reported' }),
        usage: usage && usageCompatible ? {
          inputTokens: asNumber(usage.input_tokens),
          cachedInputTokens: asNumber(usage.cached_input_tokens),
          outputTokens: asNumber(usage.output_tokens),
          reasoningOutputTokens: asNumber(usage.reasoning_output_tokens),
          nominalCost: asNumber(info?.nominal_cost),
          billedCost: asNumber(info?.billed_cost),
        } : null,
      }
    }
    if (eventType === 'item_completed') {
      const item = asObject(payload.item)
      return item
        ? normalizeCompletedItem(item, `record:${record.sourcePointer}`)
        : emptyEvent({ kind: 'item_completed', actor: 'system', summary: 'Item completed' })
    }
    if (eventType === 'patch_apply_end') {
      const sourceInvocationId = asString(payload.call_id) ?? `record:${record.sourcePointer}`
      const rawStatus = asString(payload.status)
      return {
        kind: 'tool_result',
        actor: 'tool',
        summary: 'Patch application result',
        correctionText: null,
        tool: toolEvent({
          sourceInvocationId,
          phase: 'intermediate',
          rawName: 'apply_patch',
          signature: null,
          rawStatus,
          success: asBoolean(payload.success),
          durationMs: explicitDurationMs(payload),
        }),
        usage: null,
      }
    }
    return emptyEvent({
      kind: eventType,
      actor: eventType === 'task_complete' ? 'agent' : 'system',
      summary: asString(payload.last_agent_message) ?? eventType.replaceAll('_', ' '),
    })
  }
  return emptyEvent({ kind: record.type, actor: 'system', summary: record.type.replaceAll('_', ' ') })
}

const walkJsonl = async (directory: string): Promise<string[]> => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const paths = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return walkJsonl(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat().sort()
}

const normalizeRelativePath = (sourceRoot: string, path: string): string =>
  relative(sourceRoot, path).split(sep).join('/')

const parseLine = ({
  line,
  lineOrdinal,
  relativePath,
}: {
  line: string
  lineOrdinal: number
  relativePath: string
}): { record: RawSourceRecord | null; warning: ImportWarning | null } => {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return {
      record: null,
      warning: {
        code: 'invalid_jsonl_record',
        message: `Skipped invalid JSON at line ${lineOrdinal + 1}`,
        source: relativePath,
      },
    }
  }

  const object = asObject(raw)
  const type = asString(object?.type)
  const payload = asObject(object?.payload)
  if (!object || !type || !payload) {
    return {
      record: null,
      warning: {
        code: 'invalid_rollout_record',
        message: `Skipped an unrecognized record at line ${lineOrdinal + 1}`,
        source: relativePath,
      },
    }
  }

  const explicitOrdinal = object.ordinal
  const sourceOrder = typeof explicitOrdinal === 'number' && Number.isSafeInteger(explicitOrdinal)
    ? explicitOrdinal
    : lineOrdinal

  return {
    record: {
      sourceOrder,
      sourcePointer: `${relativePath}#${sourceOrder}`,
      schemaVersion: asString(object.schema_version),
      timestamp: asString(object.timestamp),
      type,
      payload,
      raw,
    },
    warning: null,
  }
}

const parseFile = ({ content, relativePath }: { content: string; relativePath: string }): ParsedSourceFile => {
  const warnings: ImportWarning[] = []
  const rawRecords = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, lineOrdinal) => parseLine({ line, lineOrdinal, relativePath }))
    .flatMap(({ record, warning }) => {
      if (warning) warnings.push(warning)
      return record ? [record] : []
    })

  const metadata = rawRecords.find(({ type }) => type === 'session_meta')?.payload
  const productVersion = asString(metadata?.cli_version)
  const eventThreadId = rawRecords
    .map(({ payload }) => asString(payload.thread_id))
    .find((value) => value !== null)
  const sessionId = asString(metadata?.id) ?? hash(relativePath).slice(0, 24)
  const threadId = eventThreadId ?? asString(metadata?.session_id) ?? sessionId
  const repository = asString(metadata?.cwd)
  const context = rawRecords.find(({ type }) => type === 'turn_context')?.payload
  const model = asString(context?.model)
  const reasoningEffort = asString(context?.effort)
  const firstUserMessage = rawRecords.find(({ type, payload }) =>
    type === 'response_item' && payload.type === 'message' && payload.role === 'user')
  const title = firstUserMessage ? stripInjectedUserContent(extractMessage(firstUserMessage.payload)) : ''

  warnings.push({ code: 'undocumented_source_format', message: RAW_SOURCE_WARNING, source: relativePath })
  if (!productVersion) {
    warnings.push({
      code: 'unknown_codex_version',
      message: 'The session does not report a Codex version; compatibility is unknown.',
      source: relativePath,
    })
  } else if (!SUPPORTED_VERSION.test(productVersion)) {
    warnings.push({
      code: 'unsupported_codex_version',
      message: `Codex ${productVersion} has not been validated with this adapter; common records were imported with compatibility warnings.`,
      source: relativePath,
    })
  }

  return {
    threadId,
    sessionId,
    title: title || null,
    productVersion,
    repository,
    model,
    reasoningEffort,
    records: rawRecords.map((record) => ({
      ...record,
      normalized: normalizeRecord(record, productVersion !== null && SUPPORTED_VERSION.test(productVersion)),
    })),
    warnings,
  }
}

export const createCodexAdapter = ({ sourceRoot }: { sourceRoot: string }): SourceAdapter => {
  const resolvedRoot = resolve(sourceRoot)
  const installationId = `codex_${hash(resolvedRoot).slice(0, 24)}`

  return {
    adapterVersion: ADAPTER_VERSION,
    installationId,
    product: 'codex',
    sourceRoot: resolvedRoot,
    async discover(): Promise<ProductInstallationSummary> {
      const files = await walkJsonl(resolve(resolvedRoot, 'sessions'))
      let productVersion: string | null = null
      if (files.length > 0) {
        const newest = (await Promise.all(files.map(async (path) => ({ path, metadata: await stat(path) }))))
          .sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs)[0]
        if (newest) {
          const content = await readFile(newest.path, 'utf8')
          productVersion = parseFile({
            content,
            relativePath: normalizeRelativePath(resolvedRoot, newest.path),
          }).productVersion
        }
      }
      const supported = productVersion !== null && SUPPORTED_VERSION.test(productVersion)
      return {
        id: installationId,
        product: 'codex',
        productVersion,
        adapterVersion: ADAPTER_VERSION,
        sourceRoot: resolvedRoot,
        compatibility: supported ? 'warning' : files.length > 0 ? 'unsupported' : 'warning',
        warning: files.length > 0 ? DISCOVERY_WARNING : 'No Codex rollout files were found.',
        lastImportedAt: null,
      }
    },
    async enumerateFiles(): Promise<SourceFile[]> {
      const paths = await walkJsonl(resolve(resolvedRoot, 'sessions'))
      return Promise.all(paths.map(async (absolutePath) => {
        const metadata = await stat(absolutePath)
        return {
          absolutePath,
          relativePath: normalizeRelativePath(resolvedRoot, absolutePath),
          sizeBytes: metadata.size,
          modifiedAtMs: metadata.mtimeMs,
        }
      }))
    },
    async readSourceFile(file: SourceFile) {
      const content = await readFile(file.absolutePath, 'utf8')
      return {
        contentHash: hash(content),
        parsed: parseFile({ content, relativePath: file.relativePath }),
      }
    },
  }
}
