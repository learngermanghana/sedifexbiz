import { useMemo, useState } from 'react'
import './ReportDataTable.css'
import { compareReportValues, formatReportStatus, paginateRows } from './reportUtils'

export type ReportColumn<T> = {
  key: string
  label: string
  render?: (row: T) => React.ReactNode
  value?: (row: T) => string | number | Date | null | undefined
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  searchable?: boolean
}

type ReportDataTableProps<T> = {
  title?: string
  subtitle?: string
  rows: T[]
  columns: ReportColumn<T>[]
  searchPlaceholder?: string
  actions?: React.ReactNode
  filters?: React.ReactNode
  defaultPageSize?: number
  getRowKey: (row: T, index: number) => string
}

export default function ReportDataTable<T>({
  title,
  subtitle,
  rows,
  columns,
  searchPlaceholder = 'Search rows…',
  actions,
  filters,
  defaultPageSize = 25,
  getRowKey,
}: ReportDataTableProps<T>) {
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return rows
    const searchable = columns.filter(c => c.searchable !== false)
    return rows.filter(row => searchable.some(column => {
      const raw = column.value ? column.value(row) : ''
      return String(raw ?? '').toLowerCase().includes(normalized)
    }))
  }, [columns, query, rows])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const target = columns.find(c => c.key === sort.key)
    if (!target?.value) return filtered
    return [...filtered].sort((a, b) => compareReportValues(target.value?.(a), target.value?.(b), sort.direction))
  }, [columns, filtered, sort])

  const totalRows = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = paginateRows(sorted, safePage, pageSize)
  const start = totalRows === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, totalRows)

  return <div className="workspace-card report-table-card">
    {(title || subtitle || actions) && <div className="workspace-section-header report-table-header">
      <div>{title && <h2>{title}</h2>}{subtitle && <p className="workspace-muted">{subtitle}</p>}</div>
      {actions && <div className="report-toolbar-actions">{actions}</div>}
    </div>}
    <div className="workspace-toolbar report-toolbar-inline">
      <input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder={searchPlaceholder} />
      {filters}
      <label>Rows per page<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
    </div>
    <div className="workspace-table-wrap report-table-wrap">
      <table className="workspace-table report-data-table">
        <thead><tr>{columns.map(column => <th key={column.key} className={`align-${column.align || 'left'}`}>
          <button type="button" className="report-sort-btn" disabled={!column.sortable} onClick={() => setSort(prev => prev?.key === column.key ? { key: column.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key: column.key, direction: 'asc' })}>{column.label}{sort?.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        </th>)}</tr></thead>
        <tbody>{pageRows.length ? pageRows.map((row, index) => <tr key={getRowKey(row, index)}>{columns.map(column => <td key={column.key} data-label={column.label} className={`report-cell--${column.key} align-${column.align || 'left'}`}>{column.render ? column.render(row) : formatReportStatus(column.value?.(row))}</td>)}</tr>) : <tr><td colSpan={columns.length} className="report-empty">No rows found.</td></tr>}</tbody>
      </table>
    </div>
    <div className="report-pagination"><span>Showing {start}–{end} of {totalRows} rows</span><div><button type="button" className="button button--secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Prev</button><button type="button" className="button button--secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</button></div></div>
  </div>
}
