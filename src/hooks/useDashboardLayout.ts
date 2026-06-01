import { useState, useCallback } from 'react'

export type CardId = 'waterfall' | 'issue' | 'cashflow' | 'equity' | 'details'

export interface DashboardLayoutItem {
  i: CardId
  x: number; y: number; w: number; h: number
  minW?: number; minH?: number
}

// 기본 레이아웃 (12컬럼, rowHeight=56px 기준)
export const DEFAULT_LAYOUT: DashboardLayoutItem[] = [
  { i: 'waterfall', x: 0,  y: 0,  w: 8,  h: 7,  minW: 4, minH: 4 },
  { i: 'issue',     x: 8,  y: 0,  w: 4,  h: 7,  minW: 3, minH: 4 },
  { i: 'cashflow',  x: 0,  y: 7,  w: 12, h: 6,  minW: 6, minH: 4 },
  { i: 'equity',    x: 0,  y: 13, w: 8,  h: 9,  minW: 4, minH: 5 },
  { i: 'details',   x: 8,  y: 13, w: 4,  h: 9,  minW: 3, minH: 5 },
]

const LS_KEY = 'treasury_dashboard_layout'

function loadLayout(): DashboardLayoutItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed: DashboardLayoutItem[] = JSON.parse(raw)
    const savedIds = new Set(parsed.map(l => l.i))
    const allPresent = DEFAULT_LAYOUT.every(d => savedIds.has(d.i))
    return allPresent ? parsed : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function useDashboardLayout() {
  const [layout, setLayout]     = useState<DashboardLayoutItem[]>(loadLayout)
  const [editMode, setEditMode] = useState(false)

  const handleLayoutChange = useCallback((next: DashboardLayoutItem[]) => {
    setLayout(next)
  }, [])

  function saveLayout() {
    localStorage.setItem(LS_KEY, JSON.stringify(layout))
    setEditMode(false)
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT)
    localStorage.removeItem(LS_KEY)
    setEditMode(false)
  }

  function enterEditMode() { setEditMode(true) }
  function cancelEditMode() {
    setLayout(loadLayout())
    setEditMode(false)
  }

  return {
    layout,
    editMode,
    handleLayoutChange,
    saveLayout,
    resetLayout,
    enterEditMode,
    cancelEditMode,
  }
}
