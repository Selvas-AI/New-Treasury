import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { useAuth } from './useAuth'
import { generateUUID } from '../lib/format'
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
  const fetchIdRef = useRef(0)

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    const myId = ++fetchIdRef.current
    setLoading(true)
    setData([])
    setError(null)
    let query = supabase
      .from('loans')
      .select('*')
      .eq('company', fetchCompany)
      .order('maturity', { ascending: true })
    if (activeOnly) query = query.eq('active', true)
    try {
      const { data: rows, error: err } = await withTimeout(query)
      if (fetchIdRef.current !== myId) return
      if (err) setError(err.message)
      else setData((rows ?? []) as LoanRecord[])
    } catch (e) {
      if (fetchIdRef.current === myId) setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      if (fetchIdRef.current === myId) setLoading(false)
    }
  }, [fetchCompany, activeOnly])

  useEffect(() => { void fetch() }, [fetch])

  async function save(record: Omit<LoanRecord, 'id'> & { id?: string }): Promise<string | null> {
    const { error: err } = record.id
      ? await restUpdate('loans', record, { id: record.id })
      : await restInsert('loans', { ...record, id: generateUUID() })
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await restDelete('loans', { id })
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function setActive(id: string, active: boolean): Promise<string | null> {
    const { error: err } = await restUpdate('loans', { active }, { id })
    if (err) return err.message
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, save, remove, setActive }
}
