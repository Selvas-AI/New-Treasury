import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'
import { generateUUID } from '../lib/format'
import type { LoanRecord, UseQueryResult } from '../types'

export function useLoans(activeOnly = false, companyOverride?: string): UseQueryResult<LoanRecord> & {
  save: (record: Omit<LoanRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  setActive: (id: string, active: boolean) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const { logAction } = useAuditLog()
  const [data, setData] = useState<LoanRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : (companyOverride ?? currentCompany)
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
    const isNew = !record.id
    const id = record.id ?? generateUUID()
    const { error: err } = isNew
      ? await restInsert('loans', { ...record, id })
      : await restUpdate('loans', record, { id })
    if (err) return err.message
    const company = record.company || fetchCompany || ''
    const label = `${record.lender ?? ''} ${record.type ?? ''} ${record.amount ? record.amount.toLocaleString() + '원' : ''}`.trim()
    void logAction({ table: 'loans', action: isNew ? 'CREATE' : 'UPDATE', company, recordId: id, summary: isNew ? `${label} 신규 등록` : `${label} 수정`, after: record as unknown as Record<string, unknown> })
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restDelete('loans', { id })
    if (err) return err.message
    if (target) {
      const label = `${target.lender} ${target.type}`.trim()
      void logAction({ table: 'loans', action: 'DELETE', company: target.company, recordId: id, summary: `${label} 삭제`, before: target as unknown as Record<string, unknown> })
    }
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function setActive(id: string, active: boolean): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restUpdate('loans', { active }, { id })
    if (err) return err.message
    if (target) {
      const label = `${target.lender} ${target.type}`.trim()
      void logAction({ table: 'loans', action: 'SETACTIVE', company: target.company, recordId: id, summary: active ? `${label} 재활성화` : `${label} 만기처리` })
    }
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, save, remove, setActive }
}
