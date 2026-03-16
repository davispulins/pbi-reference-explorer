import { extractDaxDependencies, makeObjectId } from './dax'
import { basename, pathStartsWith } from './path'
import type { FileMap, ModelObject, ObjectId, ReportUsage } from '../types'

export interface SemanticModelScan {
  objects: ModelObject[]
  outboundRefs: Map<ObjectId, ObjectId[]>
  relationshipUsages: ReportUsage[]
  notes: Map<ObjectId, string[]>
  parseErrors: Set<ObjectId>
  ignoredTables: string[]
  warnings: string[]
}

interface TableFilterSummary {
  ignoredTables: string[]
}

function decodeTmdlName(rawName: string): string {
  const trimmed = rawName.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function cleanExpression(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/\s+$/g, '')
    .trim()
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return undefined
}

function splitObjectReference(rawReference: string): { table: string; column: string } | null {
  let splitIndex = -1
  let inQuotedIdentifier = false

  for (let index = 0; index < rawReference.length; index += 1) {
    const character = rawReference[index]

    if (character === "'") {
      if (inQuotedIdentifier && rawReference[index + 1] === "'") {
        index += 1
        continue
      }
      inQuotedIdentifier = !inQuotedIdentifier
      continue
    }

    if (character === '.' && !inQuotedIdentifier) {
      splitIndex = index
    }
  }

  if (splitIndex < 0) {
    return null
  }

  return {
    table: decodeTmdlName(rawReference.slice(0, splitIndex).trim()),
    column: decodeTmdlName(rawReference.slice(splitIndex + 1).trim()),
  }
}

function parseObjectReference(rawReference: string): ObjectId | undefined {
  const parsed = splitObjectReference(rawReference)
  if (!parsed) {
    return undefined
  }

  return makeObjectId(parsed.table, parsed.column)
}

function gatherIndentedBlock(
  lines: string[],
  startIndex: number,
  minimumIndent: number,
): { lines: string[]; endIndex: number } {
  const collected: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      collected.push('')
      index += 1
      continue
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0
    if (indent <= minimumIndent) {
      break
    }

    collected.push(line.slice(Math.min(indent, minimumIndent + 2)))
    index += 1
  }

  return { lines: collected, endIndex: index - 1 }
}

function extractExpressionFromBlock(blockLines: string[]): string | undefined {
  for (let index = 0; index < blockLines.length; index += 1) {
    const line = blockLines[index]
    const inlineMatch = line.match(/^\s*expression\s*[:=]\s*(.*)$/i)

    if (!inlineMatch) {
      continue
    }

    const inlineValue = inlineMatch[1]
    if (inlineValue.trim()) {
      return cleanExpression([inlineValue])
    }

    const nested = gatherIndentedBlock(blockLines, index + 1, 0)
    return cleanExpression(nested.lines)
  }

  return undefined
}

function shouldIgnoreTableByName(tableName: string): boolean {
  return (
    /^LocalDateTable_/i.test(tableName) ||
    /^DateTableTemplate_/i.test(tableName)
  )
}

function shouldIgnoreTableByContent(content: string): boolean {
  return (
    /annotation\s+__PBI_LocalDateTable\s*=\s*true/i.test(content) ||
    /annotation\s+__PBI_TemplateDateTable\s*=\s*true/i.test(content)
  )
}

function buildIgnoredTableSet(
  files: FileMap,
  semanticModelRoot: string,
): TableFilterSummary {
  const ignoredTables = new Set<string>()

  const tablePaths = Object.keys(files).filter(
    (path) =>
      pathStartsWith(path, semanticModelRoot) &&
      path.endsWith('.tmdl') &&
      path.includes('/definition/tables/'),
  )

  for (const path of tablePaths) {
    const content = files[path]
    const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
    const explicitName = firstLine.match(/^table\s+(.+)$/i)
    const tableName = explicitName
      ? decodeTmdlName(explicitName[1])
      : decodeTmdlName(basename(path).replace(/\.tmdl$/i, ''))

    if (
      shouldIgnoreTableByName(tableName) ||
      shouldIgnoreTableByContent(content)
    ) {
      ignoredTables.add(tableName)
    }
  }

  return { ignoredTables: Array.from(ignoredTables) }
}

function parseRelationshipCardinality(cardinality: string | undefined): string | undefined {
  const normalized = cardinality?.trim().toLowerCase()
  if (normalized === 'one') {
    return 'one'
  }
  if (normalized === 'many') {
    return 'many'
  }
  return normalized
}

function finalizeRelationshipCardinalities(relationship: {
  fromCardinality?: string
  toCardinality?: string
}) {
  if (!relationship.fromCardinality && !relationship.toCardinality) {
    relationship.fromCardinality = 'many'
    relationship.toCardinality = 'one'
    return
  }

  if (!relationship.fromCardinality) {
    relationship.fromCardinality = 'many'
  }

  if (!relationship.toCardinality) {
    relationship.toCardinality = 'many'
  }
}

function buildRelationshipUsages(
  artifactPath: string,
  relationship: {
    id: string
    fromObjectId?: ObjectId
    toObjectId?: ObjectId
    fromCardinality?: string
    toCardinality?: string
    crossFilteringBehavior?: string
    joinOnDateBehavior?: string
    isActive?: boolean
    securityFilteringBehavior?: string
  },
): ReportUsage[] {
  if (!relationship.fromObjectId || !relationship.toObjectId) {
    return []
  }

  const details = {
    id: relationship.id,
    fromObjectId: relationship.fromObjectId,
    toObjectId: relationship.toObjectId,
    fromCardinality: relationship.fromCardinality,
    toCardinality: relationship.toCardinality,
    crossFilteringBehavior: relationship.crossFilteringBehavior,
    joinOnDateBehavior: relationship.joinOnDateBehavior,
    isActive: relationship.isActive,
    securityFilteringBehavior: relationship.securityFilteringBehavior,
  }

  return [
    {
      objectId: relationship.fromObjectId,
      artifactType: 'relationship',
      artifactPath,
      reason: 'Relationship',
      relationship: details,
    },
    {
      objectId: relationship.toObjectId,
      artifactType: 'relationship',
      artifactPath,
      reason: 'Relationship',
      relationship: details,
    },
  ]
}

function parseTmdlRelationships(
  files: FileMap,
  semanticModelRoot: string,
): ReportUsage[] {
  const relationshipPath = Object.keys(files).find(
    (path) =>
      pathStartsWith(path, semanticModelRoot) &&
      path.endsWith('/definition/relationships.tmdl'),
  )

  if (!relationshipPath) {
    return []
  }

  const resolvedRelationshipPath = relationshipPath
  const usages: ReportUsage[] = []
  const lines = files[resolvedRelationshipPath].split(/\r?\n/)
  let current:
    | {
        id: string
        fromObjectId?: ObjectId
        toObjectId?: ObjectId
        fromCardinality?: string
        toCardinality?: string
        crossFilteringBehavior?: string
        joinOnDateBehavior?: string
        isActive?: boolean
        securityFilteringBehavior?: string
      }
    | undefined

  function flushCurrentRelationship() {
    if (!current) {
      return
    }

    finalizeRelationshipCardinalities(current)

    usages.push(...buildRelationshipUsages(resolvedRelationshipPath, current))
    current = undefined
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushCurrentRelationship()
      continue
    }

    const relationshipMatch = trimmed.match(/^relationship\s+(.+)$/i)
    if (relationshipMatch) {
      flushCurrentRelationship()
      current = { id: relationshipMatch[1].trim() }
      continue
    }

    if (!current) {
      continue
    }

    const propertyMatch = trimmed.match(/^([a-zA-Z]+)\s*:\s*(.+)$/)
    if (!propertyMatch) {
      continue
    }

    const [, propertyName, propertyValue] = propertyMatch
    switch (propertyName) {
      case 'fromColumn':
        current.fromObjectId = parseObjectReference(propertyValue)
        break
      case 'toColumn':
        current.toObjectId = parseObjectReference(propertyValue)
        break
      case 'fromCardinality':
        current.fromCardinality = parseRelationshipCardinality(propertyValue)
        break
      case 'toCardinality':
        current.toCardinality = parseRelationshipCardinality(propertyValue)
        break
      case 'crossFilteringBehavior':
        current.crossFilteringBehavior = propertyValue.trim()
        break
      case 'joinOnDateBehavior':
        current.joinOnDateBehavior = propertyValue.trim()
        break
      case 'isActive':
        current.isActive = parseBoolean(propertyValue)
        break
      case 'securityFilteringBehavior':
        current.securityFilteringBehavior = propertyValue.trim()
        break
      default:
        break
    }
  }

  flushCurrentRelationship()
  return usages
}

function parseTmdlFiles(files: FileMap, semanticModelRoot: string): ModelObject[] {
  const output: ModelObject[] = []
  const ignoredTables = new Set(buildIgnoredTableSet(files, semanticModelRoot).ignoredTables)
  const candidatePaths = Object.keys(files).filter(
    (path) =>
      pathStartsWith(path, semanticModelRoot) &&
      path.endsWith('.tmdl') &&
      path.includes('/definition/'),
  )

  for (const path of candidatePaths) {
    const lines = files[path].split(/\r?\n/)
    let currentTable = decodeTmdlName(basename(path).replace(/\.tmdl$/i, ''))

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const trimmed = line.trim()

      if (!trimmed) {
        continue
      }

      const tableMatch = trimmed.match(/^table\s+(.+)$/i)
      if (tableMatch) {
        currentTable = decodeTmdlName(tableMatch[1])
        continue
      }

      if (ignoredTables.has(currentTable)) {
        continue
      }

      const compactMatch = trimmed.match(/^(measure|column)\s+(.+?)\s*=\s*(.*)$/i)
      if (compactMatch) {
        const currentIndent = line.match(/^\s*/)?.[0].length ?? 0
        const kind =
          compactMatch[1].toLowerCase() === 'measure'
            ? 'measure'
            : 'calculatedColumn'
        const name = decodeTmdlName(compactMatch[2])
        const block = gatherIndentedBlock(lines, index + 1, currentIndent)
        const expression = cleanExpression([compactMatch[3]])
        output.push({
          id: makeObjectId(currentTable, name),
          table: currentTable,
          name,
          kind,
          expression,
          sourcePath: path,
        })
        index = block.endIndex
        continue
      }

      const blockMatch = trimmed.match(/^(measure|column)\s+(.+)$/i)
      if (!blockMatch) {
        continue
      }

      const kind =
        blockMatch[1].toLowerCase() === 'measure'
          ? 'measure'
          : 'calculatedColumn'
      const name = decodeTmdlName(blockMatch[2])
      const currentIndent = line.match(/^\s*/)?.[0].length ?? 0
      const block = gatherIndentedBlock(lines, index + 1, currentIndent)
      const expression = extractExpressionFromBlock(block.lines)

      if (!expression) {
        index = block.endIndex
        continue
      }

      output.push({
        id: makeObjectId(currentTable, name),
        table: currentTable,
        name,
        kind,
        expression,
        sourcePath: path,
      })
      index = block.endIndex
    }
  }

  return output
}

function parseModelBim(files: FileMap, semanticModelRoot: string): {
  objects: ModelObject[]
  relationshipUsages: ReportUsage[]
} {
  const bimPath = Object.keys(files).find(
    (path) =>
      pathStartsWith(path, semanticModelRoot) &&
      path.endsWith('/definition/model.bim'),
  )

  if (!bimPath) {
    return { objects: [], relationshipUsages: [] }
  }

  try {
    const parsed = JSON.parse(files[bimPath]) as {
      model?: {
        tables?: Array<{
          name?: string
          measures?: Array<{ name?: string; expression?: string }>
          columns?: Array<{
            name?: string
            expression?: string
            sourceColumn?: string
          }>
        }>
        relationships?: Array<{
          name?: string
          fromTable?: string
          fromColumn?: string
          fromCardinality?: string
          toTable?: string
          toColumn?: string
          toCardinality?: string
          crossFilteringBehavior?: string
          joinOnDateBehavior?: string
          isActive?: boolean
          securityFilteringBehavior?: string
        }>
      }
    }

    const output: ModelObject[] = []
    const relationshipUsages: ReportUsage[] = []
    for (const table of parsed.model?.tables ?? []) {
      if (!table.name) {
        continue
      }

      if (shouldIgnoreTableByName(table.name)) {
        continue
      }

      for (const measure of table.measures ?? []) {
        if (!measure.name || !measure.expression) {
          continue
        }

        output.push({
          id: makeObjectId(table.name, measure.name),
          table: table.name,
          name: measure.name,
          kind: 'measure',
          expression: measure.expression,
          sourcePath: bimPath,
        })
      }

      for (const column of table.columns ?? []) {
        if (!column.name || !column.expression || column.sourceColumn) {
          continue
        }

        output.push({
          id: makeObjectId(table.name, column.name),
          table: table.name,
          name: column.name,
          kind: 'calculatedColumn',
          expression: column.expression,
          sourcePath: bimPath,
        })
      }
    }

    for (const relationship of parsed.model?.relationships ?? []) {
      if (
        !relationship.fromTable ||
        !relationship.fromColumn ||
        !relationship.toTable ||
        !relationship.toColumn
      ) {
        continue
      }

      const fromObjectId = makeObjectId(
        relationship.fromTable,
        relationship.fromColumn,
      )
      const toObjectId = makeObjectId(relationship.toTable, relationship.toColumn)
      const relationshipId =
        relationship.name ??
        `${fromObjectId}->${toObjectId}`

      relationshipUsages.push(
        ...buildRelationshipUsages(bimPath, {
          id: relationshipId,
          fromObjectId,
          toObjectId,
          fromCardinality: parseRelationshipCardinality(
            relationship.fromCardinality,
          ),
          toCardinality: parseRelationshipCardinality(
            relationship.toCardinality,
          ),
          crossFilteringBehavior: relationship.crossFilteringBehavior,
          joinOnDateBehavior: relationship.joinOnDateBehavior,
          isActive: relationship.isActive,
          securityFilteringBehavior: relationship.securityFilteringBehavior,
        }),
      )
    }

    for (const usage of relationshipUsages) {
      if (usage.relationship) {
        finalizeRelationshipCardinalities(usage.relationship)
      }
    }

    return { objects: output, relationshipUsages }
  } catch {
    return { objects: [], relationshipUsages: [] }
  }
}

export function scanSemanticModel(
  files: FileMap,
  semanticModelRoot: string,
): SemanticModelScan {
  const ignoredTables = buildIgnoredTableSet(files, semanticModelRoot).ignoredTables
  const tmdlObjects = parseTmdlFiles(files, semanticModelRoot)
  const tmdlRelationshipUsages =
    tmdlObjects.length > 0
      ? parseTmdlRelationships(files, semanticModelRoot)
      : []
  const bimResult =
    tmdlObjects.length > 0
      ? { objects: [], relationshipUsages: [] }
      : parseModelBim(files, semanticModelRoot)
  const objects = tmdlObjects.length > 0 ? tmdlObjects : bimResult.objects

  const outboundRefs = new Map<ObjectId, ObjectId[]>()
  const notes = new Map<ObjectId, string[]>()
  const parseErrors = new Set<ObjectId>()

  for (const object of objects) {
    const result = extractDaxDependencies({
      currentObject: object,
      modelObjects: objects,
    })
    outboundRefs.set(object.id, result.objectIds)
    notes.set(object.id, result.notes)
    if (result.parseError) {
      parseErrors.add(object.id)
    }
  }

  return {
    objects,
    outboundRefs,
    relationshipUsages:
      tmdlObjects.length > 0 ? tmdlRelationshipUsages : bimResult.relationshipUsages,
    notes,
    parseErrors,
    ignoredTables,
    warnings:
      [
        ...(objects.length > 0
          ? []
          : ['No measures or calculated columns were found in the semantic model.']),
      ],
  }
}
