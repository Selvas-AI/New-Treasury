import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useTableSettings } from '../../hooks/useTableSettings'

// Re-export so callers can import ColumnDef from here
export type { ColumnDef }

interface NotionTableProps<T extends object> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  tableId: string
  /** Optional placeholder when data is empty */
  emptyText?: string
}

export function NotionTable<T extends object>({
  data,
  columns,
  tableId,
  emptyText = '데이터가 없습니다.',
}: NotionTableProps<T>): ReactNode {
  const { settings, updateSettings, loading } = useTableSettings(tableId)

  // ── local controlled states (initialised from DB once loaded) ──────────
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  // Apply DB settings once after first load
  useEffect(() => {
    if (loading || initialised.current) return
    initialised.current = true
    if (!settings) return

    if (settings.sortBy) {
      setSorting([{ id: settings.sortBy.key, desc: settings.sortBy.dir === 'desc' }])
    }
    if (settings.visibleColumns?.length) {
      const vis: VisibilityState = {}
      columns.forEach(col => {
        const id = String((col as { accessorKey?: string }).accessorKey ?? (col as { id?: string }).id ?? '')
        if (id) vis[id] = settings.visibleColumns.includes(id)
      })
      setColumnVisibility(vis)
    }
  }, [loading, settings, columns])

  // Sync state changes → DB (skip the initialisation round-trip)
  const prevSorting = useRef<SortingState | null>(null)
  const prevVisibility = useRef<VisibilityState | null>(null)

  useEffect(() => {
    if (!initialised.current) return
    if (
      JSON.stringify(prevSorting.current) === JSON.stringify(sorting) &&
      JSON.stringify(prevVisibility.current) === JSON.stringify(columnVisibility)
    ) return

    prevSorting.current = sorting
    prevVisibility.current = columnVisibility

    const visibleColumns = Object.entries(columnVisibility)
      .filter(([, v]) => v)
      .map(([k]) => k)

    const sortBy = sorting[0]
      ? { key: sorting[0].id, dir: (sorting[0].desc ? 'desc' : 'asc') as 'asc' | 'desc' }
      : null

    void updateSettings({ visibleColumns, sortBy })
  }, [sorting, columnVisibility, updateSettings])

  // Close popup on outside click
  useEffect(() => {
    if (!settingsOpen) return
    function handle(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [settingsOpen])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const allLeafColumns = table.getAllLeafColumns()

  return (
    <div className="flex flex-col gap-2">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {loading ? '불러오는 중…' : `총 ${table.getRowModel().rows.length.toLocaleString()}건`}
        </span>

        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <span>⚙️</span>
            <span>뷰 설정</span>
          </button>

          {settingsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
              <div className="border-b border-gray-100 dark:border-gray-700 px-3.5 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  컬럼 표시
                </p>
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {allLeafColumns.map(col => (
                  <li key={col.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={col.getIsVisible()}
                        onChange={col.getToggleVisibilityHandler()}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-500"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300">
                        {typeof col.columnDef.header === 'string'
                          ? col.columnDef.header
                          : col.id}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-100 dark:border-gray-700 px-3.5 py-2">
                <button
                  onClick={() =>
                    allLeafColumns.forEach(col => col.toggleVisibility(true))
                  }
                  className="text-[11px] text-blue-500 hover:text-blue-700 transition-colors"
                >
                  전체 표시
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60">
                {hg.headers.map(header => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={[
                        'select-none whitespace-nowrap px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400',
                        canSort ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200' : '',
                        'transition-colors',
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className={`text-[10px] transition-opacity ${sorted ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
                            {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                          </span>
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={allLeafColumns.filter(c => c.getIsVisible()).length}
                  className="px-4 py-10 text-center text-xs text-gray-400 dark:text-gray-500"
                >
                  {loading ? '불러오는 중…' : emptyText}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/40 transition-colors">
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-3.5 py-2.5 text-xs text-gray-700 dark:text-gray-300"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
