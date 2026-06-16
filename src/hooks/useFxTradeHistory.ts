import { useState, useCallback } from 'react'
import { supabase, restInsert, restUpdate } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { Company } from '../types'

export interface FxTradeRecord {
  id: string
  company: Company
  trade_date: string
  currency: string
  direction: 'sell' | 'buy'
  amount_fx: number
  acq_rate: number | null
  trade_rate: number | null
  fx_pnl: number | null
  amount_krw: number | null
  status: '발의' | '승인' | '완료' | '취소'
  memo: string | null
  created_by: string | null
  created_at: string
  approved_by: string | null
  approved_at: string | null
  completed_rate: number | null
  completed_pnl: number | null
  completed_at: string | null
  completed_by: string | null
}

export interface FxTradeFilter {
  company?: Company
  from?: string
  to?: string
  currency?: string
  status?: string
}

export function useFxTradeHistory() {
  const [data, setData]       = useState<FxTradeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetch = useCallback(async (filter: FxTradeFilter = {}) => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('fx_trade_history')
        .select('*')
        .order('trade_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (filter.company) q = q.eq('company', filter.company)
      if (filter.from)    q = q.gte('trade_date', filter.from)
      if (filter.to)      q = q.lte('trade_date', filter.to)
      if (filter.currency && filter.currency !== '전체') q = q.eq('currency', filter.currency)
      if (filter.status   && filter.status   !== '전체') q = q.eq('status', filter.status)

      const { data: rows, error: err } = await q
      if (err) throw err
      setData((rows ?? []) as FxTradeRecord[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

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
    return restInsert('fx_trade_history', { id: generateUUID(), status: '발의', ...payload })
  }, [])

  const approve = useCallback(async (id: string, approvedBy: string) => {
    return restUpdate('fx_trade_history', id, {
      status: '승인',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
  }, [])

  const complete = useCallback(async (id: string, completedRate: number, completedBy: string) => {
    const rec = data.find(r => r.id === id)
    const amtFx = rec?.amount_fx ?? 0
    const acqRate = rec?.acq_rate ?? null
    const completedPnl = acqRate != null ? (completedRate - acqRate) * amtFx : undefined
    return restUpdate('fx_trade_history', id, {
      status: '완료',
      completed_rate: completedRate,
      completed_pnl: completedPnl ?? 0,
      completed_at: new Date().toISOString(),
      completed_by: completedBy,
    })
  }, [data])

  const cancel = useCallback(async (id: string) => {
    return restUpdate('fx_trade_history', id, { status: '취소' })
  }, [])

  return { data, loading, error, fetch, propose, approve, complete, cancel }
}
