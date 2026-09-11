/**
 * 자금흐름 분석 — 저장된 조회 조건 (2026-09-11, Phase 3)
 *
 * 자주 보는 구간(직전 분기, 반기 등)을 매번 손으로 찍지 않게 한다.
 *
 * ⚠ localStorage 에만 둔다. 개인 편의 기능이라 서버에 저장할 이유가 없고,
 *   테이블을 늘리면 RLS·마이그레이션까지 따라온다.
 *   기기를 옮기면 사라진다는 점은 화면에서 밝힌다.
 */
export interface SavedFlowView {
  id: string
  name: string
  from: string
  to: string
}

const KEY = 'flow_analysis_views'
const MAX = 12

export function loadFlowViews(): SavedFlowView[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedFlowView[]
    return Array.isArray(parsed) ? parsed.filter(v => v?.id && v?.from && v?.to) : []
  } catch { return [] }
}

function persist(views: SavedFlowView[]): SavedFlowView[] {
  try { localStorage.setItem(KEY, JSON.stringify(views)) } catch { /* 무시 */ }
  return views
}

export function saveFlowView(name: string, from: string, to: string): SavedFlowView[] {
  const trimmed = name.trim() || `${from} ~ ${to}`
  const views = loadFlowViews()
  // 같은 구간을 다시 저장하면 이름만 갱신한다 — 목록이 중복으로 불어나지 않게
  const existing = views.find(v => v.from === from && v.to === to)
  if (existing) {
    existing.name = trimmed
    return persist(views)
  }
  const next: SavedFlowView = { id: `${Date.now()}`, name: trimmed, from, to }
  return persist([next, ...views].slice(0, MAX))
}

export function removeFlowView(id: string): SavedFlowView[] {
  return persist(loadFlowViews().filter(v => v.id !== id))
}
