import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { LoanRecord, UseQueryResult } from '../types'

export function useLoans(activeOnly = false): UseQueryResult<LoanRecord> & {
  save: (record: Omit<LoanRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  setActive: (id: string, active: boolean) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const [data, setData] = useState<LoanRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : currentCompany

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    setLoading(true)
    setData([])
    setError(null)
    let query = supabase
      .from('loans')
      .select('*')
      .eq('company', fetchCompany)
      .order('maturity', { ascending: true })
    if (activeOnly) query = query.eq('active', true)
    const { data: rows, error: err } = await query
    if (err) setError(err.message)
    else setData((rows ?? []) as LoanRecord[])
    setLoading(false)
  }, [fetchCompany, activeOnly])

  useEffect(() => { void fetch() }, [fetch])

  async function save(record: Omit<LoanRecord, 'id'> & { id?: string }): Promise<string | null> {
    const { error: err } = record.id
      ? await supabase.from('loans').update(record).eq('id', record.id)
      : await supabase.from('loans').insert(record)
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('loans').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function setActive(id: string, active: boolean): Promise<string | null> {
    const { error: err } = await supabase.from('loans').update({ active }).eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, save, remove, setActive }
}
