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
  relationshipId?: string
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

function getRelationshipDirectionLabel(usage: ReportUsage) {
  const relationship = usage.relationship
  if (!relationship) {
    return undefined
  }

  const crossFilterBehavior = normalizeCrossFilterBehavior(
    relationship.crossFilteringBehavior,
  )
  const isBidirectional = crossFilterBehavior === 'bothdirections'

  if (isBidirectional) {
    return `${relationship.fromObjectId} <-> ${relationship.toObjectId}`
  }

  if (
    relationship.fromCardinality === 'one' &&
    relationship.toCardinality === 'one'
  ) {
    return `${relationship.fromObjectId} <-> ${relationship.toObjectId}`
  }

  return `${relationship.toObjectId} -> ${relationship.fromObjectId}`
}

function formatRelationshipTitle(usage: ReportUsage) {
  return getRelationshipDirectionLabel(usage) ?? ''
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
    const relationshipDirection = getRelationshipDirectionLabel(usage)

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
  if (!usage.visualType) {
    return usage.title
  }

  const parts = usage.title.split(' / ')
  if (parts.length < 2) {
    return usage.title
  }

  return `Internal visual: ${parts.slice(1).join(' / ')}`
}

function groupReportUsages(usages: ReportUsage[]): GroupedReportUsage[] {
  const grouped = new Map<string, GroupedReportUsage>()

  for (const usage of usages) {
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
      relationshipId: usage.relationship?.id,
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
        <h1>PBI Reference Explorer</h1>
        <p className="upload-copy">
          Analyze a Power BI Project and find measures or calculated columns
          that are still used across the semantic model, visuals, filters,
          bookmarks, and other report definitions.
        </p>

        <section className="upload-info">
          <h2>What this tool does</h2>
          <p>
            Use this explorer to trace references, surface dependency chains,
            and identify unused measures or calculated columns that may be safe
            to remove from your model.
          </p>
          <p>
            All analysis runs entirely in your browser. No project files or
            model data are sent to external servers.
          </p>
        </section>

        <section className="upload-info">
          <h2>Use a Power BI Project (.pbip)</h2>
          <p>
            This app works with the Power BI Project format (`.pbip`) because
            the report and semantic model definitions are stored as readable
            files that can be inspected directly in the browser.
          </p>
          <p>
            If you currently have a `.pbix` file, save it as a Power BI Project
            first, then upload the full project folder or a zip of that folder.
          </p>
        </section>

        <section className="upload-info">
          <h2>Developer and source code</h2>
          <p>
            Developed by Davis Pulins.
          </p>
          <p>
            This project is open source and available on GitHub at{' '}
            <a
              href="https://github.com/davispulins/pbi-reference-explorer"
              target="_blank"
              rel="noreferrer"
            >
              github.com/davispulins/pbi-reference-explorer
            </a>
            .
          </p>
        </section>

        <section className="upload-info">
          <h2>How to save as PBIP in Power BI Desktop</h2>
          <ol className="steps-list">
            <li>Open your report in Power BI Desktop.</li>
            <li>Go to <strong>File &gt; Save As</strong>.</li>
            <li>Select <strong>Power BI Project (*.pbip)</strong>.</li>
            <li>Save the project, then upload that folder here or zip it first.</li>
          </ol>
        </section>

        <div className="upload-actions-header">
          <h2>Choose a project to analyze</h2>
          <p>
            Select either the full PBIP project folder or a zip of that folder.
          </p>
        </div>

        <div className="upload-actions">
          <label className="upload-option">
            <span className="upload-option-tag">Folder</span>
            <strong>Select project folder</strong>
            <small>Choose the saved PBIP project folder.</small>
            <span className="upload-option-cta">Browse folder</span>
            <input
              type="file"
              multiple
              onChange={onDirectoryChange}
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            />
          </label>

          <label className="upload-option">
            <span className="upload-option-tag">Zip</span>
            <strong>Select zip file</strong>
            <small>Choose a zip archive of the full PBIP folder.</small>
            <span className="upload-option-cta">Browse zip</span>
            <input type="file" accept=".zip" onChange={onZipChange} />
          </label>
        </div>

        {loading ? <p className="upload-progress">Processing project...</p> : null}
        {error ? <p className="error-text upload-error">{error}</p> : null}
      </section>
    </main>
  )
}

function App() {
  const workerRef = useRef<Worker | null>(null)
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
    return () => worker.terminate()
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
    if (!workerRef.current) {
      setError('Analysis worker is not available.')
      return
    }

    setLoading(true)
    setError('')

    const response = await new Promise<WorkerAnalyzeResponse>((resolve) => {
      const worker = workerRef.current!
      const listener = (event: MessageEvent<WorkerAnalyzeResponse>) => {
        worker.removeEventListener('message', listener)
        resolve(event.data)
      }
      worker.addEventListener('message', listener)
      worker.postMessage({ files })
    })

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

          <div className="tree-list" role="tree" aria-label="Tables and objects">
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
