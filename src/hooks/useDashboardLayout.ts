import { useState, useCallback } from 'react'
import type { Layout } from 'react-grid-layout'

export type CardId = 'waterfall' | 'issue' | 'cashflow' | 'equity' | 'details'

// 기본 레이아웃 (12컬럼, rowHeight=56px 기준)
export const DEFAULT_LAYOUT: Layout[] = [
  { i: 'waterfall', x: 0,  y: 0,  w: 8, h: 7,  minW: 4, minH: 4 },
  { i: 'issue',     x: 8,  y: 0,  w: 4, h: 7,  minW: 3, minH: 4 },
  { i: 'cashflow',  x: 0,  y: 7,  w: 12, h: 6, minW: 6, minH: 4 },
  { i: 'equity',    x: 0,  y: 13, w: 8, h: 9,  minW: 4, minH: 5 },
  { i: 'details',   x: 8,  y: 13, w: 4, h: 9,  minW: 3, minH: 5 },
]

const LS_KEY = 'treasury_dashboard_layout'

function loadLayout(): Layout[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed: Layout[] = JSON.parse(raw)
    // 저장된 키가 모두 있을 때만 사용
    const savedIds = new Set(parsed.map(l => l.i))
    const allPresent = DEFAULT_LAYOUT.every(d => savedIds.has(d.i))
    return allPresent ? parsed : DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function useDashboardLayout() {
  const [layout, setLayout]     = useState<Layout[]>(loadLayout)
  const [editMode, setEditMode] = useState(false)

  const handleLayoutChange = useCallback((next: Layout[]) => {
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
