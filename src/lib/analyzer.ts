import { resolveProject } from './pbip'
import { scanReportUsages } from './report-scanner'
import { scanSemanticModel } from './semantic-model'
import type {
  AnalysisBundle,
  AnalysisResult,
  FileMap,
  ObjectId,
} from '../types'

function unique(values: ObjectId[]): ObjectId[] {
  return Array.from(new Set(values))
}

function countDistinctReportReferences(
  usages: AnalysisResult['reportUsages'],
): number {
  const uniqueArtifacts = new Set<string>()

  for (const usage of usages) {
    uniqueArtifacts.add(
      [
        usage.artifactType,
        usage.artifactPath,
        usage.pageName ?? '',
        usage.visualName ?? '',
        usage.visualType ?? '',
      ].join('|'),
    )
  }

  return uniqueArtifacts.size
}

export function analyzeProject(files: FileMap): AnalysisBundle {
  const project = resolveProject(files)

  if (!project.semanticModelRoot || project.errors.length) {
    return {
      project,
      results: [],
      generatedAt: new Date().toISOString(),
    }
  }

  const semanticModel = scanSemanticModel(files, project.semanticModelRoot)
  project.autoHiddenTables = semanticModel.ignoredTables
  const reportUsages = scanReportUsages(files, project.reportRoots, semanticModel.objects)

  const inboundModelRefs = new Map<ObjectId, ObjectId[]>()

  for (const object of semanticModel.objects) {
    inboundModelRefs.set(object.id, [])
  }

  for (const [sourceId, targets] of semanticModel.outboundRefs.entries()) {
    for (const target of targets) {
      const current = inboundModelRefs.get(target) ?? []
      current.push(sourceId)
      inboundModelRefs.set(target, current)
    }
  }

  const usagesByObject = new Map<ObjectId, typeof reportUsages>()
  for (const usage of reportUsages) {
    const current = usagesByObject.get(usage.objectId) ?? []
    current.push(usage)
    usagesByObject.set(usage.objectId, current)
  }

  const results: AnalysisResult[] = semanticModel.objects.map((object) => {
    const outboundRefs = semanticModel.outboundRefs.get(object.id) ?? []
    const inboundRefs = unique(inboundModelRefs.get(object.id) ?? [])
    const reportHits = usagesByObject.get(object.id) ?? []
    const notes = semanticModel.notes.get(object.id) ?? []
    const referenceCount =
      inboundRefs.length + countDistinctReportReferences(reportHits)

    let status: AnalysisResult['status'] = 'UnusedCandidate'
    if (semanticModel.parseErrors.has(object.id)) {
      status = 'ParseError'
    } else if (notes.length) {
      status = 'Unknown'
    } else if (referenceCount > 0) {
      status = 'Used'
    }

    return {
      object,
      status,
      referenceCount,
      inboundModelRefs: inboundRefs,
      outboundModelRefs: outboundRefs,
      reportUsages: reportHits,
      notes,
    }
  })

  project.warnings.push(...semanticModel.warnings)

  return {
    project,
    results: results.sort((left, right) =>
      left.object.id.localeCompare(right.object.id),
    ),
    generatedAt: new Date().toISOString(),
  }
}
