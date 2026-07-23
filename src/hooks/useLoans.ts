import { useState, useEffect, useCallback, useRef } from 'react'
import { restSelect, restInsert, restUpdate, restDelete } from '../lib/supabase'
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
    const match: Record<string, string | boolean> = { company: fetchCompany }
    if (activeOnly) match.active = true
    try {
      const { data: rows, error: err } = await restSelect<LoanRecord>(
        'loans', { match, order: 'maturity.asc' },
      )
      if (fetchIdRef.current !== myId) return
      if (err) setError(err.message)
      else setData(rows ?? [])
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
      const amountLabel = target.amount ? `${target.amount.toLocaleString()}원` : ''
      const label = `${target.lender} ${target.type} ${amountLabel}`.trim()
      // 상환처리 시점의 금액을 before/after 스냅샷으로 고정 기록 — loans 테이블은 단일 row를
      // active 플래그만 바꿔 재사용하므로, 스냅샷 없이는 이후 다른 차입금의 만기처리 로그와
      // 구분이 안 되고 "금액을 알 수 없다"는 혼동이 생김 (금액 자체는 변하지 않음, 표시만 보강)
      void logAction({
        table: 'loans', action: 'SETACTIVE', company: target.company, recordId: id,
        summary: active ? `${label} 재활성화` : `${label} 만기처리`,
        before: target as unknown as Record<string, unknown>,
        after: { ...target, active } as unknown as Record<string, unknown>,
      })
    }
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, save, remove, setActive }
}
