import { useState, useEffect, useCallback, useRef } from 'react'
import { generateUUID } from '../lib/format'
import { supabase, restUpsert, restDelete, withTimeout } from '../lib/supabase'
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
  const fetchIdRef = useRef(0)

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    const myId = ++fetchIdRef.current
    setLoading(true)
    setData([])
    setError(null)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('daily').select('*').eq('company', fetchCompany).order('date', { ascending: false }),
      )
      if (fetchIdRef.current !== myId) return
      if (err) setError(err.message)
      else setData((rows ?? []) as DailyRecord[])
    } catch (e) {
      if (fetchIdRef.current === myId) setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      if (fetchIdRef.current === myId) setLoading(false)
    }
  }, [fetchCompany])

  useEffect(() => { void fetch() }, [fetch])

  async function upsert(record: Omit<DailyRecord, 'id'> & { id?: string }): Promise<string | null> {
    const payload = { ...record, id: record.id ?? generateUUID() }
    const { error: err } = await restUpsert('daily', payload)
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await restDelete('daily', { id })
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, upsert, remove }
}
