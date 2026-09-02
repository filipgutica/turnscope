import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type { ImportWarning, ProductInstallationSummary } from '../../shared/contracts.js'
import type { ParsedSourceFile, SourceAdapter, SourceFile, SourceRecord } from './types.js'

const ADAPTER_VERSION = 'codex-rollout-jsonl-v1'
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
}): { record: SourceRecord | null; warning: ImportWarning | null } => {
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
  const records = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, lineOrdinal) => parseLine({ line, lineOrdinal, relativePath }))
    .flatMap(({ record, warning }) => {
      if (warning) warnings.push(warning)
      return record ? [record] : []
    })

  const metadata = records.find(({ type }) => type === 'session_meta')?.payload
  const productVersion = asString(metadata?.cli_version)
  const eventThreadId = records
    .map(({ payload }) => asString(payload.thread_id))
    .find((value) => value !== null)
  const sessionId = asString(metadata?.id) ?? hash(relativePath).slice(0, 24)
  const threadId = eventThreadId ?? asString(metadata?.session_id) ?? sessionId
  const repository = asString(metadata?.cwd)
  const context = records.find(({ type }) => type === 'turn_context')?.payload
  const model = asString(context?.model)
  const reasoningEffort = asString(context?.effort)

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
    productVersion,
    repository,
    model,
    reasoningEffort,
    usageCompatible: productVersion !== null && SUPPORTED_VERSION.test(productVersion),
    records,
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
