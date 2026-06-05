import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
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

export function useCashflowPlan(company: Company | null) {
  const [data,    setData]    = useState<CashflowPlanRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) return
    setLoading(true)
    setData([])
    setError(null)
    const weeks = get12Weeks()
    const { data: rows, error: err } = await supabase
      .from('cashflow_plan')
      .select('*')
      .eq('company', company)
      .gte('week_start', weeks[0])
      .order('week_start')
    if (err) setError(err.message)
    else setData((rows ?? []) as CashflowPlanRow[])
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  async function upsert(
    week_start: string,
    inflow: number,
    outflow: number,
    memo: string,
    userLabel: string,
  ): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    const { error: err } = await supabase
      .from('cashflow_plan')
      .upsert({
        company, week_start, inflow, outflow, memo,
        created_by: userLabel,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company,week_start' })
    if (err) return err.message
    await fetch()
    return null
  }

  return { data, loading, error, refetch: fetch, upsert }
}
