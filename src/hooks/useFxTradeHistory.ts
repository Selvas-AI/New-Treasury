/**
 * 외화 환전 이력 훅 (fx_trade_history)
 *
 * 컬럼 매핑:
 *   acq_rate       → 장부환율 (가중평균 취득환율)
 *   trade_rate     → 매각환율 (예정)
 *   completed_rate → 실제 체결 환율
 *   completed_pnl  → 확정 환차손익
 *   fx_pnl         → 예상 환차손익 = (trade_rate - acq_rate) × amount_fx
 *   amount_krw     → 원화환산액
 *
 * 읽기: restSelect (supabase-js auth 락 회피)
 * 쓰기: restInsert / restUpdate / restDelete
 *
 * 두 가지 사용 패턴 지원:
 *   A) useFxTradeHistory(company) — 법인 고정, 자동 로드, add/remove
 *   B) useFxTradeHistory()        — 필터 기반 조회, propose/approve/complete/cancel
 */
import { useState, useCallback, useEffect } from 'react'
import { restSelect, restInsert, restUpdate, restDelete } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { FxTradeRecord, Company } from '../types'

export interface FxTradeFilter {
  company?: Company
  from?: string
  to?: string
  currency?: string
  status?: string
}

export function useFxTradeHistory(company?: Company | null) {
  const [data, setData]       = useState<FxTradeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // ── A패턴: 법인 고정 자동 로드 ─────────────────────────
  const load = useCallback(async () => {
    if (!company) return
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await restSelect<FxTradeRecord>(
        'fx_trade_history',
        { match: { company }, order: 'trade_date.desc', limit: 500 },
      )
      if (err) throw new Error(String(err))
      setData(rows ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [company])

  useEffect(() => { if (company) void load() }, [load, company])

  /** A패턴: 신규 완료 이력 간편 추가 */
  async function add(fields: {
    trade_date: string
    currency: string
    amount_fx: number
    acq_rate: number      // 장부환율(가중평균)
    trade_rate: number    // 매각환율
    memo?: string
    created_by?: string
  }) {
    const krw = Math.round(fields.amount_fx * fields.trade_rate)
    const pnl = Math.round((fields.trade_rate - fields.acq_rate) * fields.amount_fx)
    const { error: err } = await restInsert('fx_trade_history', {
      id: generateUUID(),
      company,
      direction: 'sell',
      status: '완료',
      amount_krw: krw,
      fx_pnl: pnl,
      memo: fields.memo ?? '',
      created_by: fields.created_by ?? '',
      approved_by: null, approved_at: null,
      completed_rate: null, completed_pnl: null,
      completed_at: null, completed_by: null,
      ...fields,
    })
    if (err) throw new Error(String(err))
    await load()
  }

  /** A패턴: 이력 삭제 */
  async function remove(id: string) {
    const { error: err } = await restDelete('fx_trade_history', { id })
    if (err) throw new Error(String(err))
    setData(prev => prev.filter(r => r.id !== id))
  }

  // ── B패턴: 필터 기반 조회 ────────────────────────────
  const fetch = useCallback(async (filter: FxTradeFilter = {}) => {
    setLoading(true)
    setError(null)
    try {
      // restSelect는 단일 match만 지원하므로 범위 필터는 직접 fetch
      const params = new URLSearchParams()
      params.set('order', 'trade_date.desc,created_at.desc')
      params.set('limit', '500')
      if (filter.company) params.set('company', `eq.${filter.company}`)
      if (filter.from)    params.set('trade_date', `gte.${filter.from}`)
      if (filter.to) {
        // 같은 키 두 번 → PostgREST AND: trade_date=gte.X&trade_date=lte.Y
        const existing = params.get('trade_date')
        if (existing) {
          // 이미 gte 있음 → lte 추가 (PostgREST 지원)
          params.append('trade_date', `lte.${filter.to}`)
        } else {
          params.set('trade_date', `lte.${filter.to}`)
        }
      }
      if (filter.currency && filter.currency !== '전체') params.set('currency', `eq.${filter.currency}`)
      if (filter.status   && filter.status   !== '전체') params.set('status',   `eq.${filter.status}`)

      const { data: rows, error: err } = await restSelect<FxTradeRecord>(
        'fx_trade_history',
        filter.company
          ? { match: { company: filter.company }, order: 'trade_date.desc', limit: 500 }
          : { order: 'trade_date.desc', limit: 500 },
      )
      if (err) throw new Error(String(err))
      // 클라이언트 필터 (restSelect가 범위 필터 미지원)
      let result = rows ?? []
      if (filter.from)    result = result.filter(r => r.trade_date >= filter.from!)
      if (filter.to)      result = result.filter(r => r.trade_date <= filter.to!)
      if (filter.currency && filter.currency !== '전체') result = result.filter(r => r.currency === filter.currency)
      if (filter.status   && filter.status   !== '전체') result = result.filter(r => r.status === filter.status)
      setData(result)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  /** B패턴: 발의 (워크플로우 시작) */
  const propose = useCallback(async (payload: {
    company: Company
    trade_date: string
    currency: string
    direction: 'sell' | 'buy'
    amount_fx: number
    acq_rate: number | null
    trade_rate: number | null
    fx_pnl: number | null
    amount_krw: number | null
    memo: string
    created_by: string
  }) => {
    return restInsert('fx_trade_history', {
      id: generateUUID(),
      status: '발의',
      approved_by: null, approved_at: null,
      completed_rate: null, completed_pnl: null,
      completed_at: null, completed_by: null,
      ...payload,
    })
  }, [])

  /** B패턴: 승인 */
  const approve = useCallback(async (id: string, approvedBy: string) => {
    return restUpdate('fx_trade_history', { status: '승인', approved_by: approvedBy, approved_at: new Date().toISOString() }, { id })
  }, [])

  /** B패턴: 완료 처리 (실제 체결 환율 입력) */
  const complete = useCallback(async (id: string, completedRate: number, completedBy: string) => {
    const rec      = data.find(r => r.id === id)
    const amtFx    = rec?.amount_fx ?? 0
    const acqRate  = rec?.acq_rate ?? null
    const completedPnl = acqRate != null ? Math.round((completedRate - acqRate) * amtFx) : 0
    return restUpdate(
      'fx_trade_history',
      { status: '완료', completed_rate: completedRate, completed_pnl: completedPnl, completed_at: new Date().toISOString(), completed_by: completedBy },
      { id },
    )
  }, [data])

  /** B패턴: 취소 */
  const cancel = useCallback(async (id: string) => {
    return restUpdate('fx_trade_history', { status: '취소' }, { id })
  }, [])

  /** 누적 환차손익 (완료 건, 확정값 우선) */
  const totalPnl = data
    .filter(r => r.status === '완료')
    .reduce((s, r) => s + (r.completed_pnl ?? r.fx_pnl ?? 0), 0)

  return { data, loading, error, totalPnl, load, add, remove, fetch, propose, approve, complete, cancel }
}
