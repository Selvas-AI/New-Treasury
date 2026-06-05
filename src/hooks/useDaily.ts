import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { DailyRecord, UseQueryResult } from '../types'

export function useDaily(): UseQueryResult<DailyRecord> & {
  upsert: (record: Omit<DailyRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const [data, setData] = useState<DailyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : currentCompany

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    setLoading(true)
    setData([])
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('daily')
      .select('*')
      .eq('company', fetchCompany)
      .order('date', { ascending: false })
    if (err) setError(err.message)
    else setData((rows ?? []) as DailyRecord[])
    setLoading(false)
  }, [fetchCompany])

  useEffect(() => { void fetch() }, [fetch])

  async function upsert(record: Omit<DailyRecord, 'id'> & { id?: string }): Promise<string | null> {
    const { error: err } = await supabase.from('daily').upsert(record)
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('daily').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, upsert, remove }
}
