import React, { useMemo, useState } from 'react'
import './DataTable.css'
import { FixedSizeList, ListChildComponentProps } from '../utils/VirtualizedList'

type Density = 'comfortable' | 'compact'

export type DataTableColumn<T> = {
  id: string
  header: React.ReactNode
  render: (row: T, index: number) => React.ReactNode
  align?: 'left' | 'right'
  hideBelow?: 'sm' | 'md'
  hideable?: boolean
}

type DataTableProps<T> = {
  columns: DataTableColumn<T>[]
  data: T[]
  pageSize?: number
  density?: Density
  stickyHeader?: boolean
  enableColumnToggles?: boolean
  initialHiddenColumnIds?: string[]
  rowKey?: (row: T, index: number) => string | number
  onRowClick?: (row: T, index: number) => void
  emptyState?: React.ReactNode
  virtualizeThreshold?: number
  estimatedRowHeight?: number
}

type VirtualizedItemData<T> = {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T, index: number) => string | number
  onRowClick?: (row: T, index: number) => void
}

const DEFAULT_ROW_HEIGHT = 64
const COMPACT_ROW_HEIGHT = 52

function VirtualizedRow<T>({ index, style, data }: ListChildComponentProps<VirtualizedItemData<T>>) {
  const row = data.rows[index]
  const key = data.rowKey(row, index)
  const clickable = typeof data.onRowClick === 'function'
  const handleClick = clickable ? () => data.onRowClick?.(row, index) : undefined

  return (
    <tr
      style={style as React.CSSProperties}
      className={`data-table__row ${clickable ? 'data-table__row--clickable' : ''}`}
      key={key}
      onClick={handleClick}
    >
      {data.columns.map(column => {
        const hideClass = column.hideBelow ? `data-table__cell--hide-${column.hideBelow}` : ''
        const alignClass = column.align === 'right' ? 'data-table__cell--align-right' : ''
        return (
          <td key={column.id} className={`data-table__cell ${hideClass} ${alignClass}`}>
            {column.render(row, index)}
          </td>
        )
      })}
    </tr>
  )
}

export function DataTable<T>({
  columns,
  data,
  density = 'comfortable',
  pageSize = 10,
  stickyHeader = true,
  enableColumnToggles = false,
  initialHiddenColumnIds = [],
  rowKey = (row, index) => (typeof (row as any).id !== 'undefined' ? (row as any).id : index),
  onRowClick,
  emptyState = null,
  virtualizeThreshold = 120,
  estimatedRowHeight,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(initialHiddenColumnIds))

  const visibleColumns = useMemo(() => columns.filter(col => !hiddenColumns.has(col.id)), [columns, hiddenColumns])

  const shouldVirtualize = data.length >= virtualizeThreshold
  const rowHeight = estimatedRowHeight ?? (density === 'compact' ? COMPACT_ROW_HEIGHT : DEFAULT_ROW_HEIGHT)

  const paginatedRows = useMemo(() => {
    if (shouldVirtualize) return data
    const start = page * pageSize
    return data.slice(start, start + pageSize)
  }, [data, page, pageSize, shouldVirtualize])

  const pageCount = useMemo(() => Math.max(1, Math.ceil(data.length / pageSize)), [data.length, pageSize])

  const toggleColumn = (columnId: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev)
      if (next.has(columnId)) {
        next.delete(columnId)
      } else {
        next.add(columnId)
      }
      return next
    })
  }

  const hasData = data.length > 0
  const showEmpty = !hasData
  const tableClasses = [
    'table',
    'data-table__table',
    stickyHeader ? 'data-table__table--sticky' : '',
    density === 'compact' ? 'data-table--compact' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const itemData: VirtualizedItemData<T> = useMemo(
    () => ({ rows: paginatedRows, columns: visibleColumns, rowKey, onRowClick }),
    [paginatedRows, visibleColumns, rowKey, onRowClick],
  )

  const virtualizedHeight = useMemo(() => {
    const maxHeight = 520
    const desired = paginatedRows.length * rowHeight
    return Math.min(Math.max(rowHeight * 3, desired), maxHeight)
  }, [paginatedRows.length, rowHeight])

  return (
    <div className={`data-table ${density === 'compact' ? 'data-table--compact' : ''}`}>
      {enableColumnToggles && visibleColumns.length !== columns.length && (
        <div className="data-table__column-hint" role="note">
          Hide columns you don't need and they'll stay collapsed until you refresh the page.
        </div>
      )}

      {enableColumnToggles && (
        <div className="data-table__column-toggles" aria-label="Toggle columns">
          {columns
            .filter(column => column.hideable)
            .map(column => (
              <label key={column.id} className="data-table__toggle">
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(column.id)}
                  onChange={() => toggleColumn(column.id)}
                />
                <span>{typeof column.header === 'string' ? column.header : column.id}</span>
              </label>
            ))}
        </div>
      )}

      <div className="table-wrapper data-table__table-wrapper">
        <table className={tableClasses}>
          <thead>
            <tr>
              {visibleColumns.map(column => {
                const hideClass = column.hideBelow ? `data-table__cell--hide-${column.hideBelow}` : ''
                const alignClass = column.align === 'right' ? 'data-table__cell--align-right' : ''
                return (
                  <th key={column.id} scope="col" className={`${hideClass} ${alignClass}`}>
                    {column.header}
                  </th>
                )
              })}
            </tr>
          </thead>
        </table>

        {showEmpty ? (
          <div className="data-table__empty">{emptyState}</div>
        ) : shouldVirtualize ? (
          <FixedSizeList
            height={virtualizedHeight}
            itemCount={paginatedRows.length}
            itemData={itemData}
            itemKey={(index, dataSet) => dataSet.rowKey(dataSet.rows[index], index)}
            itemSize={rowHeight}
            innerElementType={React.forwardRef<HTMLTableSectionElement>((props, ref) => (
              <tbody ref={ref} className="data-table__virtual-body" {...props} />
            ))}
            outerElementType={React.forwardRef<HTMLDivElement>((props, ref) => (
              <div ref={ref} className="data-table__virtual-outer" {...props} />
            ))}
            width="100%"
          >
            {VirtualizedRow}
          </FixedSizeList>
        ) : (
          <table className={tableClasses}>
            <tbody>
              {paginatedRows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={`data-table__row ${onRowClick ? 'data-table__row--clickable' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row, index + page * pageSize) : undefined}
                >
                  {visibleColumns.map(column => {
                    const hideClass = column.hideBelow ? `data-table__cell--hide-${column.hideBelow}` : ''
                    const alignClass = column.align === 'right' ? 'data-table__cell--align-right' : ''
                    return (
                      <td key={column.id} className={`data-table__cell ${hideClass} ${alignClass}`}>
                        {column.render(row, index + page * pageSize)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!shouldVirtualize && hasData && pageCount > 1 && (
        <div className="data-table__pagination" aria-label="Pagination">
          <div>
            Showing {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, data.length).toLocaleString()} of{' '}
            {data.length.toLocaleString()}
          </div>
          <div className="data-table__pagination-controls">
            <button type="button" className="button button--ghost" onClick={() => setPage(prev => Math.max(prev - 1, 0))} disabled={page === 0}>
              Previous
            </button>
            <div className="data-table__page-indicator">
              Page {page + 1} of {pageCount}
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setPage(prev => Math.min(prev + 1, pageCount - 1))}
              disabled={page === pageCount - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default DataTable
