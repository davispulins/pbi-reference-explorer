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
import { exportAnalysisCsv, exportAnalysisJson } from './lib/export'
import { readDirectorySelection, readZipFile } from './lib/file-loader'
import type {
  AnalysisBundle,
  AnalysisResult,
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

function humanStatus(status: AnalysisResult['status']) {
  switch (status) {
    case 'UnusedCandidate':
      return 'Unused candidate'
    case 'ParseError':
      return 'Parse error'
    default:
      return status
  }
}

function formatUsageTitle(usage: ReportUsage) {
  return [usage.pageName, usage.visualName].filter(Boolean).join(' / ') || usage.artifactPath
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
      items: items.sort((left, right) =>
        left.object.name.localeCompare(right.object.name),
      ),
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
        <h1>PBIP analyzer</h1>
        <p className="upload-copy">
          Upload a full PBIP folder or a zip archive of the project.
        </p>

        <div className="upload-actions">
          <label className="upload-option">
            <span>Folder</span>
            <strong>Select project folder</strong>
            <input
              type="file"
              multiple
              onChange={onDirectoryChange}
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            />
          </label>

          <label className="upload-option">
            <span>Zip</span>
            <strong>Select zip file</strong>
            <input type="file" accept=".zip" onChange={onZipChange} />
          </label>
        </div>

        <div className="upload-status">
          <span>{loading ? 'Processing project...' : 'Waiting for input'}</span>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
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
        const firstResult = response.bundle.results[0]
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
          <h1>Analysis</h1>
          <p className="header-copy">
            Expand a table, choose a measure or calculated column, and inspect
            how it is referenced.
          </p>
        </div>

        <div className="header-actions">
          <button type="button" onClick={() => exportAnalysisCsv(bundle)}>
            Export CSV
          </button>
          <button type="button" onClick={() => exportAnalysisJson(bundle)}>
            Export JSON
          </button>
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
                                ? 'tree-item selected'
                                : 'tree-item'
                            }
                            onClick={() => setSelectedId(result.object.id)}
                          >
                            <span
                              className={`status-dot status-${result.status}`}
                              aria-hidden="true"
                            />
                            <span className="tree-item-label">
                              {result.object.name}
                            </span>
                            <span className="tree-item-kind">
                              {result.object.kind === 'measure' ? 'M' : 'C'}
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
        </aside>

        <section className="detail-pane">
          {selectedResult ? (
            <>
              <div className="detail-header">
                <div>
                  <h2>{selectedResult.object.name}</h2>
                  <p>{selectedResult.object.table}</p>
                </div>
                <span className={`status-badge status-${selectedResult.status}`}>
                  {humanStatus(selectedResult.status)}
                </span>
              </div>

              <section className="detail-section">
                <h3>Referenced by</h3>
                <ul className="detail-list">
                  {selectedResult.inboundModelRefs.length ? (
                    selectedResult.inboundModelRefs.map((reference) => (
                      <li key={reference}>{reference}</li>
                    ))
                  ) : (
                    <li>No inbound model references found.</li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>Used in report</h3>
                <ul className="detail-list usage-list">
                  {selectedResult.reportUsages.length ? (
                    selectedResult.reportUsages.map((usage, index) => (
                      <li key={`${usage.artifactPath}-${usage.reason}-${index}`}>
                        <strong>{usage.artifactType}</strong>
                        <span>{formatUsageTitle(usage)}</span>
                        <small>{usage.reason}</small>
                      </li>
                    ))
                  ) : (
                    <li>No report usage found.</li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>Depends on</h3>
                <ul className="detail-list">
                  {selectedResult.outboundModelRefs.length ? (
                    selectedResult.outboundModelRefs.map((reference) => (
                      <li key={reference}>{reference}</li>
                    ))
                  ) : (
                    <li>No model dependencies detected.</li>
                  )}
                </ul>
              </section>

              <section className="detail-section">
                <h3>DAX expression</h3>
                <pre>{selectedResult.object.expression}</pre>
              </section>

              <section className="detail-section">
                <h3>Notes</h3>
                <ul className="detail-list">
                  {selectedResult.notes.length ? (
                    selectedResult.notes.map((note) => <li key={note}>{note}</li>)
                  ) : (
                    <li>No parser warnings for this object.</li>
                  )}
                </ul>
              </section>
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
