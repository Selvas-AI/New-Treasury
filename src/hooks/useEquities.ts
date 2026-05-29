import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { EquityRecord, UseQueryResult } from '../types'

/** 종목별 최신 날짜 1건만 반환 */
export function getLatestEquities(equities: EquityRecord[]): EquityRecord[] {
  const latest = new Map<string, EquityRecord>()
  for (const e of equities) {
    const cur = latest.get(e.name)
    if (!cur || e.date > cur.date) latest.set(e.name, e)
  }
  return Array.from(latest.values())
}

export function useEquities(): UseQueryResult<EquityRecord> & {
  /** 종목별 최신 1건 */
  latest: EquityRecord[]
  /** 특정 종목 전체 이력 */
  historyOf: (name: string) => EquityRecord[]
  save: (record: Omit<EquityRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  updateAcquisitionCost: (name: string, cost: number) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const [data, setData] = useState<EquityRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : currentCompany

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('equities')
      .select('*')
      .eq('company', fetchCompany)
      .order('date', { ascending: false })
    if (err) setError(err.message)
    else setData((rows ?? []) as EquityRecord[])
    setLoading(false)
  }, [fetchCompany])

  useEffect(() => { void fetch() }, [fetch])

  const latest = useMemo(() => getLatestEquities(data), [data])

  function historyOf(name: string): EquityRecord[] {
    return data.filter(e => e.name === name).sort((a, b) => b.date.localeCompare(a.date))
  }

  async function save(record: Omit<EquityRecord, 'id'> & { id?: string }): Promise<string | null> {
    // 동일 법인+종목명+날짜 조합 시 upsert
    if (!record.id) {
      const existing = data.find(
        e => e.company === record.company && e.name === record.name && e.date === record.date,
      )
      if (existing) record = { ...record, id: existing.id }
    }
    const { error: err } = record.id
      ? await supabase.from('equities').update(record).eq('id', record.id)
      : await supabase.from('equities').insert(record)
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('equities').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  /** 같은 종목 전체 이력에 취득가액 일괄 반영 */
  async function updateAcquisitionCost(name: string, cost: number): Promise<string | null> {
    const ids = data.filter(e => e.name === name).map(e => e.id)
    if (!ids.length) return null
    const { error: err } = await supabase
      .from('equities')
      .update({ acquisition_cost: cost })
      .in('id', ids)
    if (err) return err.message
    setData(prev => prev.map(r => r.name === name ? { ...r, acquisition_cost: cost } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, latest, historyOf, save, remove, updateAcquisitionCost }
}
