import type { AnalysisBundle, AnalysisResult } from '../types'

function downloadBlob(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string | number | undefined): string {
  if (value === undefined) {
    return ''
  }

  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function serializeCsvRow(columns: Array<string | number | undefined>): string {
  return columns.map(escapeCsv).join(',')
}

function resultRow(result: AnalysisResult): string {
  return serializeCsvRow([
    result.object.id,
    result.object.kind,
    result.status,
    result.inboundModelRefs.length,
    result.outboundModelRefs.length,
    result.reportUsages.length,
    result.object.sourcePath,
    result.notes.join(' | '),
  ])
}

export function exportAnalysisJson(bundle: AnalysisBundle) {
  downloadBlob(
    'pbip-analysis.json',
    'application/json',
    JSON.stringify(bundle, null, 2),
  )
}

export function exportAnalysisCsv(bundle: AnalysisBundle) {
  const header = serializeCsvRow([
    'objectId',
    'kind',
    'status',
    'inboundModelRefs',
    'outboundModelRefs',
    'reportUsages',
    'sourcePath',
    'notes',
  ])

  const rows = bundle.results.map(resultRow)
  downloadBlob(
    'pbip-analysis.csv',
    'text/csv;charset=utf-8',
    [header, ...rows].join('\n'),
  )
}
