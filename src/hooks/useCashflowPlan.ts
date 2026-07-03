import { useState, useCallback, useEffect } from 'react'
import { restSelect, restUpsert, restInsert, restUpdate, restDelete } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { Company } from '../types'

export interface CashflowPlanRow {
  id:         string
  company:    Company
  week_start: string   // YYYY-MM-DD (해당 주 월요일)
  inflow:     number
  outflow:    number
  memo:       string
  created_by: string
  updated_at: string
}

export interface CashflowPlanItem {
  id:         string
  company:    Company
  week_start: string
  direction:  'in' | 'out'
  category:   string
  amount:     number
  memo:       string
  created_by: string
  created_at: string
}

/** 엑셀 임포트 등 외부 데이터로부터 항목을 일괄 반영할 때 쓰는 입력 타입 */
export interface CashflowItemInput {
  week_start: string
  direction:  'in' | 'out'
  category:   string
  amount:     number
  memo?:      string
}

/** 오늘 기준 이번 주 월요일 반환 */
export function getMonday(date: Date = new Date()): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 12주치 monday 날짜 배열 (이번 주 포함) */
export function get12Weeks(from: Date = new Date()): string[] {
  const monday = getMonday(from)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

function sumBy(items: CashflowPlanItem[], week_start: string, direction: 'in' | 'out'): number {
  return items
    .filter(i => i.week_start === week_start && i.direction === direction)
    .reduce((s, i) => s + (i.amount || 0), 0)
}

export function useCashflowPlan(company: Company | null) {
  const [data,    setData]    = useState<CashflowPlanRow[]>([])
  const [items,   setItems]   = useState<CashflowPlanItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) { setData([]); setItems([]); return }
    setLoading(true)
    setError(null)
    const weeks = get12Weeks()
    const inRange = (w: string) => w >= weeks[0] && w <= weeks[weeks.length - 1]

    const [planRes, itemsRes] = await Promise.all([
      restSelect<CashflowPlanRow>('cashflow_plan', { match: { company } }),
      restSelect<CashflowPlanItem>('cashflow_plan_items', { match: { company } }),
    ])
    if (planRes.error) setError(planRes.error.message)
    else setData((planRes.data ?? []).filter(r => inRange(r.week_start)))
    setItems((itemsRes.data ?? []).filter(r => inRange(r.week_start)))
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  /** 주별 합계(inflow/outflow)를 items 배열로부터 재계산해 cashflow_plan에 반영 */
  async function syncAggregateFrom(itemsList: CashflowPlanItem[], week_start: string, userLabel: string): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    const inflow  = sumBy(itemsList, week_start, 'in')
    const outflow = sumBy(itemsList, week_start, 'out')
    const { error: err } = await restUpsert('cashflow_plan', {
      company, week_start, inflow, outflow,
      created_by: userLabel, updated_at: new Date().toISOString(),
    }, false, 'company,week_start')
    if (err) return err.message
    setData(prev => {
      const exists = prev.some(r => r.week_start === week_start)
      if (exists) return prev.map(r => r.week_start === week_start ? { ...r, inflow, outflow } : r)
      return [...prev, {
        id: generateUUID(), company, week_start, inflow, outflow,
        memo: '', created_by: userLabel, updated_at: new Date().toISOString(),
      }]
    })
    return null
  }

  /** 레거시: 주 전체를 숫자 하나로 직접 upsert (거의 안 쓰임 — 항목 기반 입력으로 대체됨) */
  async function upsert(
    week_start: string, inflow: number, outflow: number, memo: string, userLabel: string,
  ): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    const { error: err } = await restUpsert('cashflow_plan', {
      company, week_start, inflow, outflow, memo,
      created_by: userLabel, updated_at: new Date().toISOString(),
    }, false, 'company,week_start')
    if (err) return err.message
    await fetch()
    return null
  }

  /** 항목 추가 — 저장 성공 시 해당 주 합계 자동 재계산 */
  async function addItem(
    week_start: string, direction: 'in' | 'out', category: string, amount: number, memo: string, userLabel: string,
  ): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    const newItem: CashflowPlanItem = {
      id: generateUUID(), company, week_start, direction, category, amount, memo,
      created_by: userLabel, created_at: new Date().toISOString(),
    }
    const { error: err } = await restInsert('cashflow_plan_items', newItem)
    if (err) return err.message
    const nextItems = [...items, newItem]
    setItems(nextItems)
    return syncAggregateFrom(nextItems, week_start, userLabel)
  }

  /** 항목 수정 */
  async function updateItem(
    id: string, patch: { category?: string; amount?: number; memo?: string }, userLabel: string,
  ): Promise<string | null> {
    const target = items.find(i => i.id === id)
    if (!target) return '항목을 찾을 수 없습니다.'
    const { error: err } = await restUpdate('cashflow_plan_items', patch, { id })
    if (err) return err.message
    const nextItems = items.map(i => i.id === id ? { ...i, ...patch } : i)
    setItems(nextItems)
    return syncAggregateFrom(nextItems, target.week_start, userLabel)
  }

  /** 항목 삭제 */
  async function removeItem(id: string, userLabel: string): Promise<string | null> {
    const target = items.find(i => i.id === id)
    if (!target) return null
    const { error: err } = await restDelete('cashflow_plan_items', { id })
    if (err) return err.message
    const nextItems = items.filter(i => i.id !== id)
    setItems(nextItems)
    return syncAggregateFrom(nextItems, target.week_start, userLabel)
  }

  /**
   * 엑셀 임포트 일괄 동기화 — 업로드 데이터에 포함된 (법인+주차) 조합만
   * 기존 항목을 전부 지우고 파일 내용으로 교체. 그 외 주차는 건드리지 않음.
   */
  async function bulkSyncFromImport(rows: CashflowItemInput[], userLabel: string): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    if (rows.length === 0) return null
    const weeksAffected = [...new Set(rows.map(r => r.week_start))]

    // 1) 대상 주차의 기존 항목 일괄 삭제 (법인+주차 단위로 한 번씩)
    for (const week_start of weeksAffected) {
      const { error: err } = await restDelete('cashflow_plan_items', { company, week_start })
      if (err) return `${week_start} 기존 항목 삭제 실패: ${err.message}`
    }

    // 2) 신규 항목 일괄 삽입
    const newItems: CashflowPlanItem[] = rows.map(r => ({
      id: generateUUID(), company, week_start: r.week_start, direction: r.direction,
      category: r.category, amount: r.amount, memo: r.memo ?? '',
      created_by: userLabel, created_at: new Date().toISOString(),
    }))
    const { error: insErr } = await restInsert('cashflow_plan_items', newItems)
    if (insErr) return insErr.message

    // 3) 로컬 상태 갱신 (대상 주차는 통째로 교체)
    const nextItems = [...items.filter(i => !weeksAffected.includes(i.week_start)), ...newItems]
    setItems(nextItems)

    // 4) 대상 주차별 합계 재동기화
    for (const week_start of weeksAffected) {
      const err = await syncAggregateFrom(nextItems, week_start, userLabel)
      if (err) return err
    }
    return null
  }

  return {
    data, items, loading, error, refetch: fetch,
    upsert, addItem, updateItem, removeItem, bulkSyncFromImport,
  }
}
