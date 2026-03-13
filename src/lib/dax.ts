import type { ModelObject, ObjectId } from '../types'

interface ExtractionContext {
  currentObject: ModelObject
  modelObjects: ModelObject[]
}

export interface DaxDependencyResult {
  objectIds: ObjectId[]
  notes: string[]
  parseError: boolean
}

function stripStringsAndComments(expression: string): string {
  return expression
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"([^"]|"")*"/g, ' ')
}

function decodeIdentifier(identifier: string): string {
  const trimmed = identifier.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function makeId(table: string, name: string): ObjectId {
  return `${table}[${name}]`
}

function findQualifiedMatches(
  table: string,
  name: string,
  modelObjects: ModelObject[],
): ModelObject[] {
  return modelObjects.filter(
    (object) => object.table === table && object.name === name,
  )
}

function findMeasureMatches(name: string, modelObjects: ModelObject[]): ModelObject[] {
  return modelObjects.filter(
    (object) => object.kind === 'measure' && object.name === name,
  )
}

function findSameTableColumnMatches(
  table: string,
  name: string,
  modelObjects: ModelObject[],
): ModelObject[] {
  return modelObjects.filter(
    (object) =>
      object.kind === 'calculatedColumn' &&
      object.table === table &&
      object.name === name,
  )
}

export function extractDaxDependencies({
  currentObject,
  modelObjects,
}: ExtractionContext): DaxDependencyResult {
  try {
    const sanitized = stripStringsAndComments(currentObject.expression)
    const notes: string[] = []
    const resolvedIds: ObjectId[] = []

    const qualifiedPattern =
      /('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ ]*)\s*\[([^\]]+)\]/g

    for (const match of sanitized.matchAll(qualifiedPattern)) {
      const table = decodeIdentifier(match[1])
      const name = match[2].trim()
      const candidates = findQualifiedMatches(table, name, modelObjects)

      if (!candidates.length) {
        continue
      }

      if (candidates.length > 1) {
        notes.push(
          `Qualified reference ${table}[${name}] matched multiple objects; all were marked as dependencies.`,
        )
      }

      for (const candidate of candidates) {
        if (candidate.id !== currentObject.id) {
          resolvedIds.push(candidate.id)
        }
      }
    }

    const unqualifiedPattern = /(?<![A-Za-z0-9_'])\[([^\]]+)\]/g

    for (const match of sanitized.matchAll(unqualifiedPattern)) {
      const name = match[1].trim()
      const currentToken = `${currentObject.table}[${name}]`

      if (resolvedIds.includes(currentToken as ObjectId)) {
        continue
      }

      const sameTableColumns = findSameTableColumnMatches(
        currentObject.table,
        name,
        modelObjects,
      )
      const measures = findMeasureMatches(name, modelObjects)

      const candidates =
        currentObject.kind === 'measure'
          ? measures
          : [...sameTableColumns, ...measures]

      if (!candidates.length) {
        continue
      }

      if (candidates.length > 1) {
        notes.push(
          `Unqualified reference [${name}] was ambiguous; all matching objects were treated as dependencies.`,
        )
      }

      for (const candidate of candidates) {
        if (candidate.id !== currentObject.id) {
          resolvedIds.push(candidate.id)
        }
      }
    }

    return {
      objectIds: unique(resolvedIds),
      notes,
      parseError: false,
    }
  } catch (error) {
    return {
      objectIds: [],
      notes: [
        error instanceof Error
          ? error.message
          : 'Unexpected DAX parsing error.',
      ],
      parseError: true,
    }
  }
}

export function makeObjectId(table: string, name: string): ObjectId {
  return makeId(table, name)
}
