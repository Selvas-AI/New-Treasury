import { describe, it, expect, beforeEach } from 'vitest'
import { loadFlowViews, saveFlowView, removeFlowView } from './flowViews'

beforeEach(() => localStorage.clear())

describe('flowViews', () => {
  it('저장하고 다시 읽는다 — 최신이 앞에 온다', () => {
    saveFlowView('1분기', '2026-01-01', '2026-03-31')
    saveFlowView('2분기', '2026-04-01', '2026-06-30')
    expect(loadFlowViews().map(v => v.name)).toEqual(['2분기', '1분기'])
  })

  it('같은 구간을 다시 저장하면 이름만 갱신한다 — 목록이 불어나지 않는다', () => {
    saveFlowView('1분기', '2026-01-01', '2026-03-31')
    const views = saveFlowView('1Q', '2026-01-01', '2026-03-31')
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('1Q')
  })

  it('이름을 비우면 기간으로 대체한다', () => {
    const views = saveFlowView('   ', '2026-01-01', '2026-03-31')
    expect(views[0].name).toBe('2026-01-01 ~ 2026-03-31')
  })

  it('삭제한다', () => {
    const saved = saveFlowView('1분기', '2026-01-01', '2026-03-31')
    expect(removeFlowView(saved[0].id)).toHaveLength(0)
  })

  it('저장소가 깨져 있어도 빈 목록을 돌려준다 — 화면이 죽지 않는다', () => {
    localStorage.setItem('flow_analysis_views', '{나쁜 JSON')
    expect(loadFlowViews()).toEqual([])
  })
})
