import type { FileMap, ResolvedProject } from '../types'
import { dirname, normalizePath, pathStartsWith, resolvePath } from './path'

interface ReportReference {
  reportRoot: string
  byPath?: string
  byConnection?: boolean
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function walkUnknown(
  value: unknown,
  visitor: (entry: unknown, key?: string) => void,
  key?: string,
) {
  visitor(value, key)

  if (Array.isArray(value)) {
    for (const item of value) {
      walkUnknown(item, visitor)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      walkUnknown(childValue, visitor, childKey)
    }
  }
}

function extractReportReference(
  reportRoot: string,
  text: string,
): ReportReference {
  const parsed = safeJsonParse(text)
  const reference: ReportReference = { reportRoot }

  walkUnknown(parsed, (entry, key) => {
    if (!entry || typeof entry !== 'object') {
      return
    }

    const record = entry as Record<string, unknown>

    if (key === 'byConnection') {
      reference.byConnection = true
    }

    if (key === 'byPath') {
      if (typeof record.path === 'string') {
        reference.byPath = record.path
      }
      if (typeof record.Path === 'string') {
        reference.byPath = record.Path
      }
    }
  })

  return reference
}

function semanticRootFromReference(
  reportRoot: string,
  candidatePath: string,
  files: FileMap,
): string | undefined {
  const resolved = resolvePath(reportRoot, candidatePath)

  if (files[resolved]) {
    return dirname(resolved)
  }

  const asDefinitionFile = `${resolved}/definition.pbism`
  if (files[asDefinitionFile]) {
    return resolved
  }

  const matchingRoot = Object.keys(files).find((path) => {
    return (
      path.endsWith('/definition.pbism') && pathStartsWith(path, resolved)
    )
  })

  return matchingRoot ? dirname(matchingRoot) : undefined
}

export function resolveProject(files: FileMap): ResolvedProject {
  const normalizedFiles: FileMap = {}
  for (const [path, content] of Object.entries(files)) {
    normalizedFiles[normalizePath(path)] = content
  }

  const filePaths = Object.keys(normalizedFiles)
  const pbipFiles = filePaths.filter((path) => path.endsWith('.pbip'))
  const reportRoots = filePaths
    .filter((path) => path.endsWith('/definition.pbir'))
    .map((path) => dirname(path))
  const semanticRoots = filePaths
    .filter((path) => path.endsWith('/definition.pbism'))
    .map((path) => dirname(path))

  const warnings: string[] = []
  const errors: string[] = []

  if (!reportRoots.length && pbipFiles.length) {
    errors.push(
      'A standalone .pbip file was provided without the sibling report and semantic model folders.',
    )
  }

  if (!reportRoots.length) {
    errors.push('No report folder containing definition.pbir was found.')
  }

  const references = reportRoots.map((root) =>
    extractReportReference(root, normalizedFiles[`${root}/definition.pbir`]),
  )

  const linkedSemanticRoots = references
    .map((reference) => {
      if (!reference.byPath) {
        return undefined
      }

      return semanticRootFromReference(
        reference.reportRoot,
        reference.byPath,
        normalizedFiles,
      )
    })
    .filter((value): value is string => Boolean(value))

  const uniqueLinkedRoots = Array.from(new Set(linkedSemanticRoots))
  const uniqueSemanticRoots = Array.from(new Set(semanticRoots))

  let semanticModelRoot: string | undefined
  if (uniqueLinkedRoots.length === 1) {
    semanticModelRoot = uniqueLinkedRoots[0]
  } else if (!uniqueLinkedRoots.length && uniqueSemanticRoots.length === 1) {
    semanticModelRoot = uniqueSemanticRoots[0]
  } else if (uniqueLinkedRoots.length > 1) {
    warnings.push(
      'Multiple local semantic model references were found. The analyzer will use the first one.',
    )
    semanticModelRoot = uniqueLinkedRoots[0]
  } else if (uniqueSemanticRoots.length > 1) {
    warnings.push(
      'Multiple semantic model folders were found without a single clear report link. The analyzer will use the first one.',
    )
    semanticModelRoot = uniqueSemanticRoots[0]
  }

  const remoteOnlyReports = references.filter(
    (reference) => reference.byConnection && !reference.byPath,
  )
  if (remoteOnlyReports.length) {
    warnings.push(
      'At least one report points to a remote semantic model by connection. Only local by-path projects can be fully analyzed.',
    )
  }

  if (!semanticModelRoot) {
    errors.push(
      'No local semantic model folder could be resolved from definition.pbir or definition.pbism.',
    )
  }

  const activeReportRoots = semanticModelRoot
    ? reportRoots.filter((root) => {
        const reference = references.find((item) => item.reportRoot === root)
        if (!reference) {
          return true
        }
        if (reference.byConnection && !reference.byPath) {
          return false
        }
        if (!reference.byPath) {
          return true
        }
        const resolved = semanticRootFromReference(
          root,
          reference.byPath,
          normalizedFiles,
        )
        return !resolved || resolved === semanticModelRoot
      })
    : reportRoots

  return {
    reportRoots: activeReportRoots,
    semanticModelRoot,
    autoHiddenTables: [],
    warnings,
    errors,
  }
}
