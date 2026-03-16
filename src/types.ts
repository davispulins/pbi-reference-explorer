export type ObjectId = `${string}[${string}]`

export type ModelObjectKind = 'measure' | 'calculatedColumn'

export type UsageStatus = 'Used' | 'UnusedCandidate' | 'Unknown' | 'ParseError'

export interface ModelObject {
  id: ObjectId
  table: string
  name: string
  kind: ModelObjectKind
  expression: string
}

export interface RelationshipUsageDetails {
  id: string
  fromObjectId: ObjectId
  toObjectId: ObjectId
  fromCardinality?: string
  toCardinality?: string
  crossFilteringBehavior?: string
  joinOnDateBehavior?: string
  isActive?: boolean
  securityFilteringBehavior?: string
}

export interface ReportUsage {
  objectId: ObjectId
  artifactType:
    | 'visual'
    | 'filter'
    | 'page'
    | 'bookmark'
    | 'reportExtension'
    | 'relationship'
  artifactPath: string
  pageName?: string
  visualName?: string
  visualType?: string
  reason: string
  relationship?: RelationshipUsageDetails
}

export interface AnalysisResult {
  object: ModelObject
  status: UsageStatus
  referenceCount: number
  inboundModelRefs: ObjectId[]
  outboundModelRefs: ObjectId[]
  reportUsages: ReportUsage[]
  notes: string[]
}

export interface ResolvedProject {
  reportRoots: string[]
  semanticModelRoot?: string
  autoHiddenTables: string[]
  warnings: string[]
  errors: string[]
}

export interface AnalysisBundle {
  project: ResolvedProject
  results: AnalysisResult[]
}

export type FileMap = Record<string, string>

export interface WorkerAnalyzeRequest {
  requestId: number
  files: FileMap
}

export interface WorkerAnalyzeSuccess {
  ok: true
  requestId: number
  bundle: AnalysisBundle
}

export interface WorkerAnalyzeFailure {
  ok: false
  requestId: number
  error: string
}

export type WorkerAnalyzeResponse =
  | WorkerAnalyzeSuccess
  | WorkerAnalyzeFailure
