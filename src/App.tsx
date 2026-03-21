import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'

import './App.css'
import { readDirectorySelection, readZipFile } from './lib/file-loader'
import type {
  AnalysisBundle,
  AnalysisResult,
  ObjectId,
  ReportUsage,
  WorkerAnalyzeResponse,
} from './types'

interface TableGroup {
  table: string
  items: AnalysisResult[]
}

interface VisibleTableGroup extends TableGroup {
  totalCount: number
}

interface GroupedReportUsage {
  key: string
  artifactType: ReportUsage['artifactType']
  title: string
  visualType?: string
  relationshipFrom?: ObjectId
  relationshipTo?: ObjectId
  relationshipOperator?: '->' | '<->'
  reasons: string[]
}

function isUnusedCandidate(result: AnalysisResult) {
  return result.status === 'UnusedCandidate' && result.referenceCount === 0
}

function compareResults(left: AnalysisResult, right: AnalysisResult) {
  const leftHasNoReferences = left.referenceCount === 0
  const rightHasNoReferences = right.referenceCount === 0

  if (leftHasNoReferences !== rightHasNoReferences) {
    return leftHasNoReferences ? -1 : 1
  }

  if (isUnusedCandidate(left) !== isUnusedCandidate(right)) {
    return isUnusedCandidate(left) ? -1 : 1
  }

  if (left.referenceCount !== right.referenceCount) {
    return left.referenceCount - right.referenceCount
  }

  return left.object.name.localeCompare(right.object.name)
}

function parseObjectReference(reference: ObjectId | string) {
  const match = /^(.*?)(\[[^\]]+\])$/.exec(reference)
  if (!match) {
    return null
  }

  return {
    table: match[1],
    object: match[2],
  }
}

function ObjectReference(props: { reference: ObjectId | string }) {
  const parsed = parseObjectReference(props.reference)

  if (!parsed) {
    return <code className="object-reference">{props.reference}</code>
  }

  return (
    <code className="object-reference">
      <span className="object-reference-table">{parsed.table}</span>
      <span className="object-reference-name">{parsed.object}</span>
    </code>
  )
}

function ObjectReferenceButton(props: {
  reference: ObjectId
  onSelect: (reference: ObjectId) => void
}) {
  return (
    <button
      type="button"
      className="object-reference-button"
      onClick={() => props.onSelect(props.reference)}
    >
      <ObjectReference reference={props.reference} />
    </button>
  )
}

function ObjectKindIcon(props: { kind: AnalysisResult['object']['kind'] }) {
  const iconPath =
    props.kind === 'measure'
      ? '/measure-icon.svg'
      : '/calculated-column-icon.svg'
  const label =
    props.kind === 'measure' ? 'Measure' : 'Calculated column'

  return (
    <span className="object-kind-marker" title={label}>
      <img
        className="object-kind-icon"
        src={iconPath}
        alt=""
        aria-hidden="true"
      />
      <span className="object-kind-letter" aria-hidden="true">
        {props.kind === 'measure' ? 'M' : 'C'}
      </span>
    </span>
  )
}

function formatReferenceLabel(count: number) {
  return `${count} ${count === 1 ? 'reference' : 'references'}`
}

function normalizeCrossFilterBehavior(value: string | undefined) {
  return value?.trim().toLowerCase()
}

function getRelationshipDisplayParts(usage: ReportUsage): {
  left: ObjectId
  right: ObjectId
  operator: '->' | '<->'
} | undefined {
  const relationship = usage.relationship
  if (!relationship) {
    return undefined
  }

  const crossFilterBehavior = normalizeCrossFilterBehavior(
    relationship.crossFilteringBehavior,
  )
  const isBidirectional = crossFilterBehavior === 'bothdirections'

  if (isBidirectional) {
    return {
      left: relationship.fromObjectId,
      right: relationship.toObjectId,
      operator: '<->',
    }
  }

  if (
    relationship.fromCardinality === 'one' &&
    relationship.toCardinality === 'one'
  ) {
    return {
      left: relationship.fromObjectId,
      right: relationship.toObjectId,
      operator: '<->',
    }
  }

  return {
    left: relationship.toObjectId,
    right: relationship.fromObjectId,
    operator: '->',
  }
}

function formatRelationshipTitle(usage: ReportUsage) {
  const parts = getRelationshipDisplayParts(usage)
  return parts ? `${parts.left} ${parts.operator} ${parts.right}` : ''
}

function formatUsageTitle(usage: ReportUsage) {
  if (usage.artifactType === 'relationship' && usage.relationship) {
    return formatRelationshipTitle(usage)
  }

  return [usage.pageName, usage.visualName].filter(Boolean).join(' / ') || usage.artifactPath
}

function formatVisualType(visualType: string) {
  return visualType
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatProjectionRole(role: string) {
  const normalized = role.toLowerCase()
  const roleMap: Record<string, string> = {
    x: 'Used on X axis',
    y: 'Used on Y axis',
    values: 'Used in Values',
    rows: 'Used in Rows',
    columns: 'Used in Columns',
    legend: 'Used in Legend',
    tooltips: 'Used in Tooltips',
    category: 'Used in Category',
    series: 'Used in Series',
  }

  return roleMap[normalized] ?? `Used in ${role}`
}

function summarizeUsageReason(usage: ReportUsage) {
  if (usage.artifactType === 'relationship' && usage.relationship) {
    const reasons: string[] = []
    const fromCardinality = usage.relationship.fromCardinality
    const toCardinality = usage.relationship.toCardinality
    const relationshipDirection = formatRelationshipTitle(usage)

    if (fromCardinality || toCardinality) {
      reasons.push(
        `Cardinality: ${fromCardinality ?? 'unknown'} to ${toCardinality ?? 'unknown'}`,
      )
    }

    if (relationshipDirection) {
      reasons.push(
        `Cross-filter: ${relationshipDirection}`,
      )
    }

    if (usage.relationship.joinOnDateBehavior) {
      reasons.push(
        `Join on date: ${usage.relationship.joinOnDateBehavior}`,
      )
    }

    if (usage.relationship.isActive !== undefined) {
      reasons.push(usage.relationship.isActive ? 'Active relationship' : 'Inactive relationship')
    }

    if (usage.relationship.securityFilteringBehavior) {
      reasons.push(
        `Security filtering: ${usage.relationship.securityFilteringBehavior}`,
      )
    }

    return reasons.length ? reasons.join(' | ') : 'Used in semantic-model relationship'
  }

  const reason = usage.reason.toLowerCase()
  const tokens = usage.reason.split(' > ')
  const queryStateIndex = tokens.findIndex(
    (token) => token.toLowerCase() === 'querystate',
  )

  if (queryStateIndex >= 0 && tokens[queryStateIndex + 1]) {
    return formatProjectionRole(tokens[queryStateIndex + 1])
  }

  if (reason.includes('filterconfig') || reason.includes('filters')) {
    return usage.visualName ? 'Used in visual filter' : 'Used in filter'
  }

  if (reason.includes('sortdefinition') || reason.includes('sort')) {
    return 'Used in sort'
  }

  if (reason.includes('measurereference')) {
    return 'Referenced by report extension measure'
  }

  if (reason.includes('reportextensionexpression')) {
    return 'Used in report extension expression'
  }

  if (reason.includes('bookmark')) {
    return 'Used in bookmark'
  }

  if (reason.includes('drill')) {
    return 'Used in drill configuration'
  }

  return `Referenced in ${usage.artifactType}`
}

function formatUsageHeading(usage: GroupedReportUsage) {
  if (usage.artifactType === 'relationship') {
    if (
      usage.relationshipFrom &&
      usage.relationshipTo &&
      usage.relationshipOperator
    ) {
      return (
        <span className="relationship-heading">
          <ObjectReference reference={usage.relationshipFrom} />
          <span className="relationship-operator">{usage.relationshipOperator}</span>
          <ObjectReference reference={usage.relationshipTo} />
        </span>
      )
    }

    return usage.title
  }

  if (usage.artifactType === 'page' && usage.title.endsWith('/definition/report.json')) {
    return 'All pages'
  }

  if (usage.visualType) {
    const pageName = usage.title.split(' / ')[0]
    return `${pageName} / ${formatVisualType(usage.visualType)}`
  }

  return usage.title
}

function formatUsageMeta(usage: GroupedReportUsage) {
  const parts = usage.title.split(' / ')
  if (parts.length < 2) {
    return usage.title
  }

  return `Internal visual: ${parts.slice(1).join(' / ')}`
}

function groupReportUsages(usages: ReportUsage[]): GroupedReportUsage[] {
  const grouped = new Map<string, GroupedReportUsage>()

  for (const usage of usages) {
    const relationshipParts = getRelationshipDisplayParts(usage)
    const key = [
      usage.artifactType,
      usage.artifactPath,
      usage.pageName ?? '',
      usage.visualName ?? '',
      usage.visualType ?? '',
      usage.relationship?.id ?? '',
    ].join('|')

    const existing = grouped.get(key)
    const summarizedReasons = summarizeUsageReason(usage).split(' | ')

    if (existing) {
      for (const summarizedReason of summarizedReasons) {
        if (!existing.reasons.includes(summarizedReason)) {
          existing.reasons.push(summarizedReason)
        }
      }
      continue
    }

    grouped.set(key, {
      key,
      artifactType: usage.artifactType,
      title: formatUsageTitle(usage),
      visualType: usage.visualType,
      relationshipFrom: relationshipParts?.left,
      relationshipTo: relationshipParts?.right,
      relationshipOperator: relationshipParts?.operator,
      reasons: summarizedReasons,
    })
  }

  return Array.from(grouped.values())
}

function matchesSearch(result: AnalysisResult, query: string) {
  if (!query) {
    return true
  }

  return (
    result.object.name.toLowerCase().includes(query) ||
    result.object.id.toLowerCase().includes(query) ||
    result.status.toLowerCase().includes(query)
  )
}

function groupByTable(bundle: AnalysisBundle | null): TableGroup[] {
  const groups = new Map<string, AnalysisResult[]>()

  for (const result of bundle?.results ?? []) {
    const current = groups.get(result.object.table) ?? []
    current.push(result)
    groups.set(result.object.table, current)
  }

  return Array.from(groups.entries())
    .map(([table, items]) => ({
      table,
      items: items.sort(compareResults),
    }))
    .sort((left, right) => left.table.localeCompare(right.table))
}

function UploadScreen(props: {
  loading: boolean
  error: string
  onDirectoryChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  onZipChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}) {
  const { loading, error, onDirectoryChange, onZipChange } = props

  return (
    <main className="upload-shell">
      <section className="upload-panel">
        <div className="upload-hero">
          <div className="upload-hero-copy">
            <span className="upload-eyebrow">Power BI project analysis</span>
            <h1>PBI Reference Explorer</h1>
            <p className="upload-copy">
              Open a saved PBIP project to check which measures and calculated
              columns are still used.
            </p>

            <ul className="upload-summary-list">
              <li>See where an object is referenced in the model and report.</li>
              <li>Find likely unused measures and calculated columns.</li>
              <li>Analysis runs locally in your browser.</li>
            </ul>
          </div>

          <section className="upload-action-panel">
            <div className="upload-actions-header">
              <span className="upload-section-kicker">Start here</span>
              <h2>Choose a PBIP project to analyze</h2>
              <p>
                Select the project folder. If you have a zip of that same
                folder, you can use that instead.
              </p>
            </div>

            <div className="upload-actions">
              <label className="upload-option upload-option-primary">
                <span className="upload-option-tag">Recommended</span>
                <strong>Select project folder</strong>
                <small>
                  Use this when you have the PBIP folder on your computer.
                </small>
                <span className="upload-option-cta">Browse folder</span>
                <input
                  type="file"
                  multiple
                  disabled={loading}
                  onChange={onDirectoryChange}
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
              </label>

              <label className="upload-option">
                <span className="upload-option-tag">Fallback</span>
                <strong>Select zip file</strong>
                <small>Use a zip file that contains that same PBIP folder.</small>
                <span className="upload-option-cta">Browse zip</span>
                <input
                  type="file"
                  accept=".zip"
                  disabled={loading}
                  onChange={onZipChange}
                />
              </label>
            </div>

            <p className="upload-action-note">
              This app is read-only. It does not change your files.
            </p>

            {loading ? <p className="upload-progress">Processing project...</p> : null}
            {error ? <p className="error-text upload-error">{error}</p> : null}
          </section>
        </div>

        <div className="upload-support-grid">
          <section className="upload-info upload-info-steps">
            <h2>Save as PBIP first</h2>
            <ol className="steps-list">
              <li>Open your report in Power BI Desktop.</li>
              <li>Go to <strong>File &gt; Save As</strong>.</li>
              <li>Select <strong>Power BI Project (*.pbip)</strong>.</li>
              <li>Upload that folder here, or zip the folder and upload the archive.</li>
            </ol>
          </section>

          <section className="upload-info">
            <h2>What gets analyzed</h2>
            <ul className="upload-checklist">
              <li>Find unused measures and calculated columns</li>
              <li>Checks whether they are used in visuals, filters, and relationships</li>
              <li>Shows where each object is still being used</li>
            </ul>
          </section>

          <section className="upload-info">
            <h2>Privacy and scope</h2>
            <p>
              This app is client-side JavaScript only. It does not send your
              data to any external server.
            </p>
          </section>
        </div>

        <p className="upload-footer">
          Developed by Davis Pulins. Source available on{' '}
          <a
            href="https://github.com/davispulins/pbi-reference-explorer"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </section>
    </main>
  )
}

function App() {
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const [bundle, setBundle] = useState<AnalysisBundle | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    const worker = new Worker(
      new URL('./workers/analyzer.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    return () => {
      workerRef.current = null
      worker.terminate()
    }
  }, [])

  const tableGroups = useMemo(() => groupByTable(bundle), [bundle])
  const query = deferredSearch.trim().toLowerCase()

  const visibleGroups = useMemo<VisibleTableGroup[]>(() => {
    return tableGroups
      .map((group) => {
        const items = query
          ? group.items.filter((result) => matchesSearch(result, query))
          : group.items
        const tableMatches = query && group.table.toLowerCase().includes(query)

        return {
          table: group.table,
          totalCount: group.items.length,
          items: tableMatches ? group.items : items,
        }
      })
      .filter((group) => (query ? group.items.length > 0 : true))
  }, [query, tableGroups])

  const flatVisibleItems = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  )

  const effectiveSelectedId =
    selectedId && flatVisibleItems.some((item) => item.object.id === selectedId)
      ? selectedId
      : flatVisibleItems[0]?.object.id ?? ''

  const selectedResult =
    flatVisibleItems.find((item) => item.object.id === effectiveSelectedId) ??
    bundle?.results.find((item) => item.object.id === effectiveSelectedId)
  const groupedReportUsages = selectedResult
    ? groupReportUsages(selectedResult.reportUsages)
    : []
  const resultIds = useMemo(
    () => new Set(bundle?.results.map((result) => result.object.id) ?? []),
    [bundle],
  )

  async function runAnalysis(files: Record<string, string>) {
    const worker = workerRef.current
    if (!worker) {
      setError('Analysis worker is not available.')
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError('')

    try {
      const response = await new Promise<WorkerAnalyzeResponse>(
        (resolve, reject) => {
          const handleMessage = (event: MessageEvent<WorkerAnalyzeResponse>) => {
            if (event.data.requestId !== requestId) {
              return
            }

            cleanup()
            resolve(event.data)
          }
          const handleError = (event: ErrorEvent) => {
            cleanup()
            reject(new Error(event.message || 'Analysis worker failed.'))
          }
          const cleanup = () => {
            worker.removeEventListener('message', handleMessage)
            worker.removeEventListener('error', handleError)
          }

          worker.addEventListener('message', handleMessage)
          worker.addEventListener('error', handleError)
          worker.postMessage({ requestId, files })
        },
      )

      if (requestId !== requestIdRef.current) {
        return
      }

      startTransition(() => {
        if (response.ok) {
          setBundle(response.bundle)
          const firstResult = groupByTable(response.bundle)[0]?.items[0]
          setSelectedId(firstResult?.object.id ?? '')
          setExpandedTables(
            firstResult ? { [firstResult.object.table]: true } : {},
          )
        } else {
          setError(response.error)
        }

        setLoading(false)
      })
    } catch (analysisError) {
      if (requestId !== requestIdRef.current) {
        return
      }

      setError(
        analysisError instanceof Error
          ? analysisError.message
          : 'Unknown analysis error.',
      )
      setLoading(false)
    }
  }

  async function handleDirectoryChange(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList?.length) {
      return
    }

    await runAnalysis(await readDirectorySelection(fileList))
    event.target.value = ''
  }

  async function handleZipChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    await runAnalysis(await readZipFile(file))
    event.target.value = ''
  }

  function toggleTable(table: string) {
    setExpandedTables((current) => ({
      ...current,
      [table]: !current[table],
    }))
  }

  function selectObjectReference(reference: ObjectId) {
    const target = bundle?.results.find((result) => result.object.id === reference)
    if (!target) {
      return
    }

    setSelectedId(reference)
    setSearch('')
    setExpandedTables((current) => ({
      ...current,
      [target.object.table]: true,
    }))
  }

  if (!bundle) {
    return (
      <UploadScreen
        loading={loading}
        error={error}
        onDirectoryChange={handleDirectoryChange}
        onZipChange={handleZipChange}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Reference analysis</h1>
          <p className="header-copy">
            Review measures and calculated columns, see where they are still
            referenced, and identify unused objects that can likely be deleted
            from the model.
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            onClick={() => {
              setBundle(null)
              setSelectedId('')
              setExpandedTables({})
              setSearch('')
              setError('')
            }}
          >
            Open another project
          </button>
        </div>
      </header>

      <main className="analysis-layout">
        <aside className="tree-pane">
          <div className="tree-toolbar">
            <input
              type="search"
              className="tree-search"
              placeholder="Search tables or objects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="tree-list">
            {visibleGroups.map((group) => {
              const isExpanded = query ? true : Boolean(expandedTables[group.table])

              return (
                <section key={group.table} className="tree-group">
                  <button
                    type="button"
                    className="tree-table"
                    onClick={() => toggleTable(group.table)}
                    aria-expanded={isExpanded}
                  >
                    <span className="tree-chevron">{isExpanded ? '▾' : '▸'}</span>
                    <span className="tree-table-name">{group.table}</span>
                    <span className="tree-count">
                      {group.items.length}
                      {group.items.length !== group.totalCount ? ` / ${group.totalCount}` : ''}
                    </span>
                  </button>

                  {isExpanded ? (
                    <ul className="tree-items">
                      {group.items.map((result) => (
                        <li key={result.object.id}>
                          <button
                            type="button"
                            className={
                              result.object.id === effectiveSelectedId
                                ? isUnusedCandidate(result)
                                  ? 'tree-item tree-item-unused selected'
                                  : 'tree-item selected'
                                : isUnusedCandidate(result)
                                  ? 'tree-item tree-item-unused'
                                  : 'tree-item'
                            }
                            onClick={() => setSelectedId(result.object.id)}
                          >
                            <ObjectKindIcon kind={result.object.kind} />
                            <span className="tree-item-label">
                              {result.object.name}
                            </span>
                            <span className="tree-item-meta">
                              {isUnusedCandidate(result) ? (
                                <span className="tree-item-flag">Unused</span>
                              ) : null}
                              <span className="tree-item-references">
                                {formatReferenceLabel(result.referenceCount)}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              )
            })}

            {!visibleGroups.length ? (
              <p className="empty-panel">No measures or calculated columns found.</p>
            ) : null}
          </div>

          {bundle.project.autoHiddenTables.length ? (
            <details className="hidden-tables hidden-tables-bottom">
              <summary>
                Auto-hidden tables ({bundle.project.autoHiddenTables.length})
              </summary>
              <ul className="hidden-table-list">
                {bundle.project.autoHiddenTables.map((table) => (
                  <li key={table}>{table}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </aside>

        <section className="detail-pane">
          {selectedResult ? (
            <>
              <div className="detail-header">
                <div>
                  <h2>{selectedResult.object.name}</h2>
                  <p>{selectedResult.object.table}</p>
                </div>
                <div className="detail-header-meta">
                  <span className="detail-reference-total">
                    {formatReferenceLabel(selectedResult.referenceCount)}
                  </span>
                </div>
              </div>

              <section className="detail-section">
                <h3>Used in report/model</h3>
                <ul className="detail-list usage-list">
                  {groupedReportUsages.length ? (
                    groupedReportUsages.map((usage) => (
                      <li key={usage.key}>
                        <strong>{usage.artifactType}</strong>
                        <span>{formatUsageHeading(usage)}</span>
                        {usage.visualType ? (
                          <small>{formatUsageMeta(usage)}</small>
                        ) : null}
                        {usage.reasons.map((reason) => (
                          <small key={reason}>{reason}</small>
                        ))}
                      </li>
                    ))
                  ) : (
                    <li className="detail-empty-text">No report usage found.</li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>Referenced by</h3>
                <ul className="detail-list grouped-detail-list">
                  {selectedResult.inboundModelRefs.length ? (
                    selectedResult.inboundModelRefs.map((reference) => (
                      <li key={reference}>
                        {resultIds.has(reference) ? (
                          <ObjectReferenceButton
                            reference={reference}
                            onSelect={selectObjectReference}
                          />
                        ) : (
                          <ObjectReference reference={reference} />
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="detail-empty-text">
                      No inbound model references found.
                    </li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>Depends on</h3>
                <ul className="detail-list grouped-detail-list">
                  {selectedResult.outboundModelRefs.length ? (
                    selectedResult.outboundModelRefs.map((reference) => (
                      <li key={reference}>
                        {resultIds.has(reference) ? (
                          <ObjectReferenceButton
                            reference={reference}
                            onSelect={selectObjectReference}
                          />
                        ) : (
                          <ObjectReference reference={reference} />
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="detail-empty-text">
                      No model dependencies detected.
                    </li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>DAX expression</h3>
                <pre>{selectedResult.object.expression}</pre>
              </section>

              {selectedResult.notes.length ? (
                <section className="detail-section detail-section-warning">
                  <h3>Warnings</h3>
                  <ul className="detail-list">
                    {selectedResult.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty-detail">
              <h2>No object selected</h2>
              <p>Select an item from the tree to inspect its references.</p>
            </div>
          )}
        </section>
      </main>

      {(bundle.project.errors.length || bundle.project.warnings.length || error) ? (
        <section className="notes-panel">
          {error ? <p className="error-text">{error}</p> : null}
          {bundle.project.errors.map((item) => (
            <p key={item} className="error-text">
              {item}
            </p>
          ))}
          {bundle.project.warnings.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </section>
      ) : null}
    </div>
  )
}

export default App
