import { extractDaxDependencies } from './dax'
import { basename, normalizePath, pathStartsWith } from './path'
import type { FileMap, ModelObject, ObjectId, ReportUsage } from '../types'

interface ScanContext {
  aliasMap: Record<string, string>
  pageName?: string
  visualName?: string
  visualType?: string
  artifactPath: string
  artifactType: ReportUsage['artifactType']
  reasonPrefix: string[]
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function resolveArtifactType(path: string): ReportUsage['artifactType'] {
  const normalized = normalizePath(path)

  if (normalized.includes('/bookmarks/')) {
    return 'bookmark'
  }
  if (normalized.includes('/visuals/')) {
    return 'visual'
  }
  if (/reportextensions?\.json$/i.test(normalized)) {
    return 'reportExtension'
  }
  if (normalized.includes('filter')) {
    return 'filter'
  }
  return 'page'
}

function extractAliasMap(node: Record<string, unknown>): Record<string, string> {
  const aliases: Record<string, string> = {}
  const fromEntries = Array.isArray(node.From) ? node.From : []

  for (const entry of fromEntries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const record = entry as Record<string, unknown>
    const alias =
      typeof record.Name === 'string'
        ? record.Name
        : typeof record.Source === 'string'
          ? record.Source
          : undefined
    const entity =
      typeof record.Entity === 'string'
        ? record.Entity
        : typeof record.name === 'string'
          ? record.name
          : undefined

    if (alias && entity) {
      aliases[alias] = entity
    }
  }

  return aliases
}

function resolveEntity(
  expression: Record<string, unknown> | undefined,
  aliases: Record<string, string>,
): string | undefined {
  const expr = expression?.Expression
  if (!expr || typeof expr !== 'object') {
    return undefined
  }

  const sourceRef = (expr as Record<string, unknown>).SourceRef
  if (!sourceRef || typeof sourceRef !== 'object') {
    return undefined
  }

  const record = sourceRef as Record<string, unknown>

  if (typeof record.Entity === 'string') {
    return record.Entity
  }

  if (typeof record.Source === 'string') {
    return aliases[record.Source]
  }

  return undefined
}

function makeUsage(
  objectId: ObjectId,
  context: ScanContext,
  reason: string,
): ReportUsage {
  return {
    objectId,
    artifactType: context.artifactType,
    artifactPath: context.artifactPath,
    pageName: context.pageName,
    visualName: context.visualName,
    visualType: context.visualType,
    reason,
  }
}

function collectPageNames(files: FileMap, reportRoot: string): Record<string, string> {
  const output: Record<string, string> = {}

  for (const [path, content] of Object.entries(files)) {
    if (
      !pathStartsWith(path, reportRoot) ||
      !path.endsWith('/page.json') ||
      !path.includes('/pages/')
    ) {
      continue
    }

    const parsed = safeParseJson(content) as Record<string, unknown> | undefined
    const match = path.match(/\/pages\/([^/]+)\/page\.json$/)
    if (!match) {
      continue
    }

    output[match[1]] =
      typeof parsed?.displayName === 'string' ? parsed.displayName : match[1]
  }

  return output
}

function inferPageName(
  path: string,
  pageNames: Record<string, string>,
): string | undefined {
  const match = path.match(/\/pages\/([^/]+)/)
  return match ? pageNames[match[1]] ?? match[1] : undefined
}

function inferVisualName(path: string): string | undefined {
  const match = path.match(/\/visuals\/([^/]+)/)
  return match?.[1]
}

function collectVisualTypes(
  files: FileMap,
  reportRoot: string,
): Record<string, string> {
  const output: Record<string, string> = {}

  for (const [path, content] of Object.entries(files)) {
    if (
      !pathStartsWith(path, reportRoot) ||
      !path.endsWith('/visual.json') ||
      !path.includes('/visuals/')
    ) {
      continue
    }

    const parsed = safeParseJson(content) as
      | {
          visual?: {
            visualType?: string
          }
        }
      | undefined

    const match = path.match(/\/visuals\/([^/]+)\/visual\.json$/)
    const visualName = match?.[1]
    const visualType = parsed?.visual?.visualType

    if (visualName && visualType) {
      output[visualName] = visualType
    }
  }

  return output
}

function scanNode(
  node: unknown,
  context: ScanContext,
  modelObjects: ModelObject[],
  usages: ReportUsage[],
) {
  if (Array.isArray(node)) {
    for (const value of node) {
      scanNode(value, context, modelObjects, usages)
    }
    return
  }

  if (!node || typeof node !== 'object') {
    return
  }

  const record = node as Record<string, unknown>
  const nextContext: ScanContext = {
    ...context,
    aliasMap: { ...context.aliasMap, ...extractAliasMap(record) },
  }

  const measure = record.Measure
  if (measure && typeof measure === 'object') {
    const property = (measure as Record<string, unknown>).Property
    const entity = resolveEntity(
      measure as Record<string, unknown>,
      nextContext.aliasMap,
    )
    if (entity && typeof property === 'string') {
      usages.push(
        makeUsage(
          `${entity}[${property}]`,
          nextContext,
          [...nextContext.reasonPrefix, 'Measure'].join(' > '),
        ),
      )
    }
  }

  const column = record.Column
  if (column && typeof column === 'object') {
    const property = (column as Record<string, unknown>).Property
    const entity = resolveEntity(
      column as Record<string, unknown>,
      nextContext.aliasMap,
    )
    if (entity && typeof property === 'string') {
      usages.push(
        makeUsage(
          `${entity}[${property}]`,
          nextContext,
          [...nextContext.reasonPrefix, 'Column'].join(' > '),
        ),
      )
    }
  }

  if (
    typeof record.entity === 'string' &&
    typeof record.name === 'string' &&
    context.artifactType === 'reportExtension'
  ) {
    usages.push(
      makeUsage(
        `${record.entity}[${record.name}]`,
        nextContext,
        [...nextContext.reasonPrefix, 'MeasureReference'].join(' > '),
      ),
    )
  }

  if (
    context.artifactType === 'reportExtension' &&
    typeof record.expression === 'string'
  ) {
    const syntheticObject: ModelObject = {
      id: `__reportExtension[${basename(context.artifactPath)}]`,
      table: '__reportExtension',
      name: basename(context.artifactPath),
      kind: 'measure',
      expression: record.expression,
      sourcePath: context.artifactPath,
    }
    const extracted = extractDaxDependencies({
      currentObject: syntheticObject,
      modelObjects,
    })
    for (const objectId of extracted.objectIds) {
      usages.push(
        makeUsage(
          objectId,
          nextContext,
          [...nextContext.reasonPrefix, 'ReportExtensionExpression'].join(' > '),
        ),
      )
    }
  }

  for (const [key, value] of Object.entries(record)) {
    scanNode(
      value,
      {
        ...nextContext,
        reasonPrefix: [...nextContext.reasonPrefix, key],
      },
      modelObjects,
      usages,
    )
  }
}

export function scanReportUsages(
  files: FileMap,
  reportRoots: string[],
  modelObjects: ModelObject[],
): ReportUsage[] {
  const usages: ReportUsage[] = []

  for (const reportRoot of reportRoots) {
    const pageNames = collectPageNames(files, reportRoot)
    const visualTypes = collectVisualTypes(files, reportRoot)

    for (const [path, content] of Object.entries(files)) {
      if (
        !pathStartsWith(path, reportRoot) ||
        !path.includes('/definition/') ||
        !path.endsWith('.json')
      ) {
        continue
      }

      const parsed = safeParseJson(content)
      if (parsed === undefined) {
        continue
      }

      scanNode(
        parsed,
        {
          aliasMap: {},
          pageName: inferPageName(path, pageNames),
          visualName: inferVisualName(path),
          visualType: visualTypes[inferVisualName(path) ?? ''],
          artifactPath: path,
          artifactType: resolveArtifactType(path),
          reasonPrefix: [],
        },
        modelObjects,
        usages,
      )
    }
  }

  const deduped = new Map<string, ReportUsage>()
  for (const usage of usages) {
    const key = [
      usage.objectId,
      usage.artifactPath,
      usage.pageName ?? '',
      usage.visualName ?? '',
      usage.visualType ?? '',
      usage.reason,
    ].join('|')
    deduped.set(key, usage)
  }

  return Array.from(deduped.values())
}
