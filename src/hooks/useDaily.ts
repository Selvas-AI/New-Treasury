import { useState, useEffect, useCallback, useRef } from 'react'
import { generateUUID } from '../lib/format'
import { supabase, restUpsert, restDelete, withTimeout } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'
import type { DailyRecord, UseQueryResult } from '../types'

export function useDaily(): UseQueryResult<DailyRecord> & {
  upsert: (record: Omit<DailyRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const { logAction } = useAuditLog()
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
    const isNew = !record.id
    const payload = { ...record, id: record.id ?? generateUUID() }
    const { error: err } = await restUpsert('daily', payload)
    if (err) return err.message
    const company = record.company || fetchCompany || ''
    void logAction({ table: 'daily', action: isNew ? 'CREATE' : 'UPDATE', company, recordId: payload.id, summary: `운전자금 ${record.date ?? ''} ${isNew ? '입력' : '수정'}` })
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restDelete('daily', { id })
    if (err) return err.message
    void logAction({ table: 'daily', action: 'DELETE', company: target?.company || fetchCompany || '', recordId: id, summary: `운전자금 ${target?.date ?? ''} 삭제` })
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, upsert, remove }
}
