import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import type { ImportProgress, ImportResult, ImportWarning } from '../shared/contracts.js'
import type { SourceAdapter, SourceRecord } from './adapters/types.js'
import { classifyCorrection, rebuildSignals, refreshSessionMetrics } from './analytics.js'
import type { TurnscopeDatabase } from './db.js'
import { redactPayload, redactText } from './redaction.js'

const hashId = (prefix: string, value: string): string =>
  `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const extractMessage = (payload: Record<string, unknown>): string => {
  const content = Array.isArray(payload.content) ? payload.content : []
  return content
    .flatMap((entry) => {
      const object = asObject(entry)
      const text = asString(object?.text)
      return text ? [text] : []
    })
    .join('\n')
}

interface NormalizedEvent {
  kind: string
  actor: 'user' | 'agent' | 'tool' | 'system' | null
  summary: string
  toolName: string | null
  toolSignature: string | null
  toolStatus: string | null
  durationMs: number | null
  usage: {
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
    reasoningOutputTokens: number | null
    nominalCost: number | null
    billedCost: number | null
  } | null
}

const completedItemText = (item: Record<string, unknown>, fallback: string): string =>
  asString(item.text)
  ?? asString(item.summary)
  ?? asString(item.message)
  ?? asString(item.name)
  ?? fallback

const normalizeCompletedItem = (item: Record<string, unknown>): NormalizedEvent => {
  const itemType = asString(item.type) ?? 'unknown'
  const normalizedItemType = itemType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  const reportedStatus = asString(item.status)

  if (normalizedItemType === 'user_message' || normalizedItemType === 'agent_message') {
    const actor = normalizedItemType === 'user_message' ? 'user' : 'agent'
    return {
      kind: actor === 'user' ? 'user_message_completed' : 'agent_message_completed',
      actor,
      summary: completedItemText(item, actor === 'user' ? 'User message' : 'Agent message'),
      toolName: null,
      toolSignature: null,
      toolStatus: reportedStatus,
      durationMs: null,
      usage: null,
    }
  }

  if (normalizedItemType === 'reasoning') {
    return {
      kind: 'reasoning', actor: 'agent', summary: completedItemText(item, 'Reasoning event'),
      toolName: null, toolSignature: null, toolStatus: reportedStatus, durationMs: null, usage: null,
    }
  }

  if (normalizedItemType === 'file_change' || normalizedItemType === 'extension') {
    return {
      kind: normalizedItemType,
      actor: 'agent',
      summary: completedItemText(item, normalizedItemType.replaceAll('_', ' ')),
      toolName: null,
      toolSignature: null,
      toolStatus: reportedStatus,
      durationMs: null,
      usage: null,
    }
  }

  if (normalizedItemType === 'sub_agent_activity' || normalizedItemType === 'collab_agent_tool_call') {
    return {
      kind: 'subagent_activity',
      actor: 'agent',
      summary: completedItemText(item, 'Subagent activity'),
      toolName: null,
      toolSignature: null,
      toolStatus: reportedStatus,
      durationMs: asNumber(item.duration_ms) ?? asNumber(item.duration),
      usage: null,
    }
  }

  const toolTypes = new Set([
    'command_execution',
    'dynamic_tool_call',
    'function_call',
    'mcp_tool_call',
    'tool_call',
    'web_search',
  ])
  if (toolTypes.has(normalizedItemType)) {
    const command = asString(item.command)
    const toolName = asString(item.name)
      ?? (normalizedItemType === 'command_execution' ? 'command' : normalizedItemType)
    const exitCode = asNumber(item.exit_code) ?? asNumber(item.exitCode)
    const status = exitCode !== null && exitCode !== 0
      ? 'failed'
      : reportedStatus ?? (exitCode === 0 ? 'completed' : null)
    return {
      kind: 'tool_completion',
      actor: 'tool',
      summary: command ?? `${toolName} ${status ?? 'completed'}`,
      toolName,
      toolSignature: command ?? asString(item.id),
      toolStatus: status,
      durationMs: asNumber(item.duration_ms) ?? asNumber(item.duration),
      usage: null,
    }
  }

  return {
    kind: 'item_completed',
    actor: 'system',
    summary: completedItemText(item, `${itemType} completed`),
    toolName: null,
    toolSignature: null,
    toolStatus: reportedStatus,
    durationMs: null,
    usage: null,
  }
}

const normalizeRecord = (record: SourceRecord, usageCompatible: boolean): NormalizedEvent => {
  const { payload } = record
  if (record.type === 'session_meta') {
    return {
      kind: 'session_meta', actor: 'system', summary: 'Session started',
      toolName: null, toolSignature: null, toolStatus: null, durationMs: null, usage: null,
    }
  }

  if (record.type === 'turn_context') {
    const model = asString(payload.model)
    return {
      kind: 'turn_context', actor: 'system', summary: model ? `Turn context: ${model}` : 'Turn context',
      toolName: null, toolSignature: null, toolStatus: null, durationMs: null, usage: null,
    }
  }

  if (record.type === 'response_item' && payload.type === 'message') {
    const role = asString(payload.role)
    const summary = extractMessage(payload) || 'Message'
    const kind = role === 'user'
      ? 'user_turn'
      : role === 'assistant'
        ? 'agent_turn'
        : 'system_message'
    return {
      kind,
      actor: role === 'user' ? 'user' : role === 'assistant' ? 'agent' : 'system',
      summary,
      toolName: null,
      toolSignature: null,
      toolStatus: null,
      durationMs: null,
      usage: null,
    }
  }

  if (record.type === 'response_item') {
    const responseType = asString(payload.type) ?? 'response_item'
    if (responseType === 'reasoning') return normalizeCompletedItem(payload)
    if (responseType === 'agent_message' || responseType === 'user_message') {
      const message = normalizeCompletedItem(payload)
      return {
        ...message,
        kind: responseType === 'user_message' ? 'user_turn' : 'agent_turn',
      }
    }
    const name = asString(payload.name) ?? responseType.replace(/_output$/, '')
    const output = asString(payload.output)
    const argumentsText = asString(payload.arguments) ?? asString(payload.input)
    const isResult = responseType.endsWith('_output') || responseType.endsWith('_result')
    const isTool = isResult
      || responseType.endsWith('_call')
      || ['function_call', 'mcp_call', 'web_search_call'].includes(responseType)
    if (!isTool) {
      return {
        kind: 'response_item', actor: 'system', summary: completedItemText(payload, responseType),
        toolName: null, toolSignature: null, toolStatus: asString(payload.status), durationMs: null, usage: null,
      }
    }
    return {
      kind: isResult ? 'tool_result' : 'tool_call',
      actor: 'tool',
      summary: output ?? argumentsText ?? name,
      toolName: name,
      toolSignature: argumentsText ?? asString(payload.call_id) ?? asString(payload.id),
      toolStatus: asString(payload.status),
      durationMs: null,
      usage: null,
    }
  }

  if (record.type === 'event_msg') {
    const eventType = asString(payload.type) ?? 'event_msg'
    if (eventType === 'token_count') {
      const info = asObject(payload.info)
      const usage = asObject(info?.last_token_usage)
      return {
        kind: 'usage', actor: 'system', summary: 'Token usage reported',
        toolName: null, toolSignature: null, toolStatus: null, durationMs: null,
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
      return item ? normalizeCompletedItem(item) : {
        kind: 'item_completed', actor: 'system', summary: 'Item completed',
        toolName: null, toolSignature: null, toolStatus: null, durationMs: null, usage: null,
      }
    }

    return {
      kind: eventType,
      actor: eventType === 'task_complete' ? 'agent' : 'system',
      summary: asString(payload.last_agent_message) ?? eventType.replaceAll('_', ' '),
      toolName: null, toolSignature: null, toolStatus: null, durationMs: null, usage: null,
    }
  }

  return {
    kind: record.type,
    actor: 'system',
    summary: record.type.replaceAll('_', ' '),
    toolName: null, toolSignature: null, toolStatus: null, durationMs: null, usage: null,
  }
}

const getSessionFields = (records: SourceRecord[]) => {
  const timestamps = records.flatMap(({ timestamp }) => timestamp ? [timestamp] : []).sort()
  const firstUserMessage = records.find(({ type, payload }) =>
    type === 'response_item' && payload.type === 'message' && payload.role === 'user')
  const titleText = firstUserMessage ? extractMessage(firstUserMessage.payload) : ''
  return {
    title: titleText ? redactText(titleText).slice(0, 120) : 'Untitled session',
    startedAt: timestamps[0] ?? null,
    endedAt: timestamps.at(-1) ?? null,
  }
}

const importParsedFile = ({
  database,
  adapter,
  relativePath,
  contentHash,
  sizeBytes,
  modifiedAtMs,
  parsed,
  importedAt,
  importBatchId,
}: {
  database: TurnscopeDatabase
  adapter: SourceAdapter
  relativePath: string
  contentHash: string
  sizeBytes: number
  modifiedAtMs: number
  parsed: Awaited<ReturnType<SourceAdapter['readSourceFile']>>['parsed']
  importedAt: string
  importBatchId: string
}): { inserted: number; unchanged: number; sessionId: string } => {
  const threadId = hashId('thread', `${adapter.installationId}:${parsed.threadId}`)
  const sessionId = hashId('session', `${adapter.installationId}:${relativePath}`)
  const sessionFields = getSessionFields(parsed.records)

  database.prepare(`
    INSERT INTO threads (id, installation_id, source_thread_id)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_thread_id = excluded.source_thread_id
  `).run(threadId, adapter.installationId, parsed.threadId)

  database.prepare(`
    INSERT INTO sessions (
      id, installation_id, thread_id, source_session_id, source_file, title, started_at, ended_at,
      repository, model, reasoning_effort
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      thread_id = excluded.thread_id,
      source_session_id = excluded.source_session_id,
      source_file = excluded.source_file,
      title = excluded.title,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      repository = COALESCE(excluded.repository, sessions.repository),
      model = COALESCE(excluded.model, sessions.model),
      reasoning_effort = COALESCE(excluded.reasoning_effort, sessions.reasoning_effort)
  `).run(
    sessionId,
    adapter.installationId,
    threadId,
    parsed.sessionId,
    relativePath,
    sessionFields.title,
    sessionFields.startedAt,
    sessionFields.endedAt,
    parsed.repository,
    parsed.model,
    parsed.reasoningEffort,
  )

  let inserted = 0
  let unchanged = 0

  for (const record of parsed.records) {
    const identity = `${adapter.installationId}:${relativePath}:${record.sourceOrder}`
    const sourceRecordId = hashId('source', identity)
    const eventId = hashId('event', identity)
    const compressedPayload = gzipSync(JSON.stringify(redactPayload(record.raw)))
    const existing = database.prepare('SELECT id FROM source_records WHERE id = ?').get(sourceRecordId)

    if (existing) unchanged += 1
    else inserted += 1

    database.prepare(`
      INSERT INTO source_records (
        id, installation_id, session_id, source_file, source_pointer, source_schema_version,
        source_order, imported_at, last_seen_import_id, redacted_payload_gzip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        source_file = excluded.source_file,
        source_schema_version = excluded.source_schema_version,
        imported_at = excluded.imported_at,
        last_seen_import_id = excluded.last_seen_import_id,
        redacted_payload_gzip = excluded.redacted_payload_gzip
    `).run(
      sourceRecordId,
      adapter.installationId,
      sessionId,
      relativePath,
      record.sourcePointer,
      record.schemaVersion,
      record.sourceOrder,
      importedAt,
      importBatchId,
      compressedPayload,
    )

    const event = normalizeRecord(record, parsed.usageCompatible)
    const summary = redactText(event.summary)
    const toolName = event.toolName === null ? null : redactText(event.toolName)
    const toolSignature = event.toolSignature === null ? null : redactText(event.toolSignature)
    database.prepare(`
      INSERT INTO events (
        id, installation_id, session_id, source_record_id, kind, actor, occurred_at,
        source_order, summary, tool_name, tool_signature, tool_status, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        actor = excluded.actor,
        occurred_at = excluded.occurred_at,
        summary = excluded.summary,
        tool_name = excluded.tool_name,
        tool_signature = excluded.tool_signature,
        tool_status = excluded.tool_status,
        duration_ms = excluded.duration_ms
    `).run(
      eventId,
      adapter.installationId,
      sessionId,
      sourceRecordId,
      event.kind,
      event.actor,
      record.timestamp,
      record.sourceOrder,
      summary,
      toolName,
      toolSignature,
      event.toolStatus,
      event.durationMs,
    )

    database.prepare('DELETE FROM usage_records WHERE event_id = ?').run(eventId)
    if (event.usage) {
      database.prepare(`
        INSERT INTO usage_records (
          id, installation_id, session_id, event_id, input_tokens, cached_input_tokens,
          output_tokens, reasoning_output_tokens, nominal_cost, billed_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashId('usage', eventId),
        adapter.installationId,
        sessionId,
        eventId,
        event.usage.inputTokens,
        event.usage.cachedInputTokens,
        event.usage.outputTokens,
        event.usage.reasoningOutputTokens,
        event.usage.nominalCost,
        event.usage.billedCost,
      )
    }

    if (event.actor === 'user') {
      const correction = classifyCorrection(summary)
      if (correction) {
        database.prepare(`
          INSERT INTO corrections (
            id, installation_id, session_id, event_id, category, confidence, explanation
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            session_id = excluded.session_id,
            category = excluded.category,
            confidence = excluded.confidence,
            explanation = excluded.explanation
        `).run(
          hashId('correction', eventId),
          adapter.installationId,
          sessionId,
          eventId,
          correction.category,
          correction.confidence,
          correction.explanation,
        )
      } else database.prepare(`
        DELETE FROM corrections WHERE event_id = ? AND classification_method = 'heuristic'
      `).run(eventId)
    } else {
      database.prepare(`
        DELETE FROM corrections WHERE event_id = ? AND classification_method = 'heuristic'
      `).run(eventId)
    }
  }

  database.prepare(`
    DELETE FROM source_records
    WHERE installation_id = ? AND source_file = ? AND last_seen_import_id <> ?
  `).run(adapter.installationId, relativePath, importBatchId)
  database.prepare(`
    INSERT INTO source_files (
      installation_id, relative_path, content_hash, size_bytes, modified_at_ms, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(installation_id, relative_path) DO UPDATE SET
      content_hash = excluded.content_hash,
      size_bytes = excluded.size_bytes,
      modified_at_ms = excluded.modified_at_ms,
      imported_at = excluded.imported_at
  `).run(adapter.installationId, relativePath, contentHash, sizeBytes, modifiedAtMs, importedAt)

  return { inserted, unchanged, sessionId }
}

const uniqueWarnings = (warnings: ImportWarning[]): ImportWarning[] => {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.source ?? ''}:${warning.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const importFromAdapter = async ({
  database,
  adapter,
  onProgress,
}: {
  database: TurnscopeDatabase
  adapter: SourceAdapter
  onProgress?: (progress: ImportProgress) => void
}): Promise<ImportResult> => {
  const startedAt = new Date().toISOString()
  const warnings: ImportWarning[] = []
  let filesScanned = 0
  let filesImported = 0
  let filesSkipped = 0
  let recordsInserted = 0
  let recordsUnchanged = 0
  const affectedSessions = new Set<string>()
  const reportProgress = ({
    phase,
    currentFile = null,
  }: {
    phase: ImportProgress['phase']
    currentFile?: string | null
  }): void => onProgress?.({
    phase,
    filesTotal: filesScanned,
    filesProcessed: filesImported + filesSkipped,
    filesImported,
    filesSkipped,
    recordsInserted,
    recordsUnchanged,
    warningCount: warnings.length,
    currentFile,
  })

  database.prepare(`
    INSERT INTO product_installations (
      id, product, product_version, source_root, adapter_version, compatibility, warning, last_imported_at
    ) VALUES (?, ?, NULL, ?, ?, 'warning', 'Discovery has not completed.', NULL)
    ON CONFLICT(id) DO UPDATE SET
      source_root = excluded.source_root,
      adapter_version = excluded.adapter_version
  `).run(
    adapter.installationId,
    adapter.product,
    adapter.sourceRoot,
    adapter.adapterVersion,
  )

  try {
    reportProgress({ phase: 'discovering' })
    const discovery = await adapter.discover()
    const files = await adapter.enumerateFiles()
    filesScanned = files.length
    reportProgress({ phase: 'importing' })
    database.prepare(`
      UPDATE product_installations
      SET product_version = ?, compatibility = ?, warning = ?
      WHERE id = ?
    `).run(
      discovery.productVersion,
      discovery.compatibility,
      discovery.warning,
      adapter.installationId,
    )

    for (const file of files) {
    const cursor = database.prepare(`
      SELECT
        content_hash AS contentHash,
        size_bytes AS sizeBytes,
        modified_at_ms AS modifiedAtMs
      FROM source_files
      WHERE installation_id = ? AND relative_path = ?
    `).get(adapter.installationId, file.relativePath) as {
      contentHash: string
      sizeBytes: number
      modifiedAtMs: number
    } | undefined

    if (cursor?.sizeBytes === file.sizeBytes && cursor.modifiedAtMs === file.modifiedAtMs) {
      filesSkipped += 1
      reportProgress({ phase: 'importing', currentFile: file.relativePath })
      continue
    }

    const { contentHash, parsed } = await adapter.readSourceFile(file)
    if (cursor?.contentHash === contentHash) {
      database.prepare(`
        UPDATE source_files
        SET size_bytes = ?, modified_at_ms = ?, imported_at = ?
        WHERE installation_id = ? AND relative_path = ?
      `).run(
        file.sizeBytes,
        file.modifiedAtMs,
        startedAt,
        adapter.installationId,
        file.relativePath,
      )
      filesSkipped += 1
      reportProgress({ phase: 'importing', currentFile: file.relativePath })
      continue
    }

    warnings.push(...parsed.warnings)
    const result = database.transaction(() => importParsedFile({
      database,
      adapter,
      relativePath: file.relativePath,
      contentHash,
      sizeBytes: file.sizeBytes,
      modifiedAtMs: file.modifiedAtMs,
      parsed,
      importedAt: startedAt,
      importBatchId: randomUUID(),
    }))()
    filesImported += 1
    recordsInserted += result.inserted
    recordsUnchanged += result.unchanged
    affectedSessions.add(result.sessionId)
    reportProgress({ phase: 'importing', currentFile: file.relativePath })
    }

    database.transaction(() => {
      database.prepare(`
        DELETE FROM sessions
        WHERE installation_id = ?
          AND NOT EXISTS (SELECT 1 FROM source_records WHERE source_records.session_id = sessions.id)
      `).run(adapter.installationId)
      database.prepare(`
        DELETE FROM threads
        WHERE installation_id = ?
          AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.thread_id = threads.id)
      `).run(adapter.installationId)
    })()

    reportProgress({ phase: 'analyzing' })
    for (const sessionId of affectedSessions) {
      refreshSessionMetrics({ database, sessionId })
      rebuildSignals({ database, sessionId })
    }

    const completedAt = new Date().toISOString()
    database.prepare(`
      UPDATE product_installations
      SET last_imported_at = ?, product_version = COALESCE(product_version, ?)
      WHERE id = ?
    `).run(completedAt, discovery.productVersion, adapter.installationId)

    const resultWarnings = uniqueWarnings(warnings)
    database.prepare(`
      INSERT INTO import_audits (
        id, installation_id, started_at, completed_at, files_scanned,
        files_imported, records_inserted, warnings_json, status, error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', NULL)
    `).run(
      randomUUID(),
      adapter.installationId,
      startedAt,
      completedAt,
      filesScanned,
      filesImported,
      recordsInserted,
      JSON.stringify(resultWarnings),
    )

    return {
      installationId: adapter.installationId,
      filesScanned,
      filesImported,
      filesSkipped,
      recordsInserted,
      recordsUnchanged,
      warnings: resultWarnings,
    }
  } catch (error) {
    const completedAt = new Date().toISOString()
    const errorText = redactText(error instanceof Error ? error.message : String(error))
    database.prepare(`
      INSERT INTO import_audits (
        id, installation_id, started_at, completed_at, files_scanned,
        files_imported, records_inserted, warnings_json, status, error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failure', ?)
    `).run(
      randomUUID(),
      adapter.installationId,
      startedAt,
      completedAt,
      filesScanned,
      filesImported,
      recordsInserted,
      JSON.stringify(uniqueWarnings(warnings)),
      errorText,
    )
    throw error
  }
}
