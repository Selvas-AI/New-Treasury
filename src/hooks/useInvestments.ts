import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { InvestmentRecord, UseQueryResult } from '../types'

/** 국채 종목별 최신 날짜 1건만 반환 */
export function getLatestBonds(investments: InvestmentRecord[]): InvestmentRecord[] {
  const bonds = investments.filter(i => i.product === '국채')
  const latest = new Map<string, InvestmentRecord>()
  for (const b of bonds) {
    const key = b.bondTicker ?? b.bondName ?? b.bank
    const cur = latest.get(key)
    if (!cur || (b.priceDate ?? '') > (cur.priceDate ?? '')) latest.set(key, b)
  }
  return Array.from(latest.values())
}

/** 비국채 active + 국채 종목별 최신 1건 합산 */
export function getLatestInvestments(investments: InvestmentRecord[]): InvestmentRecord[] {
  const nonBond = investments.filter(i => i.product !== '국채' && i.active)
  return [...nonBond, ...getLatestBonds(investments)]
}

export function useInvestments(activeOnly = false): UseQueryResult<InvestmentRecord> & {
  bonds: InvestmentRecord[]
  nonBonds: InvestmentRecord[]
  save: (record: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  setActive: (id: string, active: boolean) => Promise<string | null>
  updateAcquisitionCost: (ids: string[], cost: number) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const [data, setData] = useState<InvestmentRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : currentCompany

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    setLoading(true)
    setError(null)
    let query = supabase
      .from('investments')
      .select('*')
      .eq('company', fetchCompany)
      .order('maturity', { ascending: true })
    if (activeOnly) query = query.eq('active', true)
    const { data: rows, error: err } = await query
    if (err) setError(err.message)
    else setData((rows ?? []) as InvestmentRecord[])
    setLoading(false)
  }, [fetchCompany, activeOnly])

  useEffect(() => { void fetch() }, [fetch])

  const bonds = useMemo(() => data.filter(i => i.product === '국채'), [data])
  const nonBonds = useMemo(() => data.filter(i => i.product !== '국채'), [data])

  async function save(record: Omit<InvestmentRecord, 'id'> & { id?: string }): Promise<string | null> {
    const { error: err } = record.id
      ? await supabase.from('investments').update(record).eq('id', record.id)
      : await supabase.from('investments').insert(record)
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('investments').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function setActive(id: string, active: boolean): Promise<string | null> {
    const { error: err } = await supabase.from('investments').update({ active }).eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  /** 과거 이력 일괄 취득가액 반영 */
  async function updateAcquisitionCost(ids: string[], cost: number): Promise<string | null> {
    const { error: err } = await supabase
      .from('investments')
      .update({ acquisition_cost: cost })
      .in('id', ids)
    if (err) return err.message
    setData(prev => prev.map(r => ids.includes(r.id) ? { ...r, acquisition_cost: cost } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, bonds, nonBonds, save, remove, setActive, updateAcquisitionCost }
}
