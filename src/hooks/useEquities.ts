import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { restSelect, restInsert, restUpdate, restDelete } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'
import { generateUUID } from '../lib/format'
import type { EquityRecord, UseQueryResult } from '../types'

/** 중복키(23505) — 같은 법인·종목·기준일 행이 이미 있다는 뜻 */
function isDuplicateKey(msg?: string): boolean {
  if (!msg) return false
  return msg.includes('23505') || msg.includes('duplicate key') || msg.includes('already exists')
}

/** 종목별 최신 날짜 1건만 반환 */
export function getLatestEquities(equities: EquityRecord[]): EquityRecord[] {
  const latest = new Map<string, EquityRecord>()
  for (const e of equities) {
    const cur = latest.get(e.name)
    if (!cur || e.date > cur.date) latest.set(e.name, e)
  }
  return Array.from(latest.values())
}

export function useEquities(companyOverride?: string): UseQueryResult<EquityRecord> & {
  /** 종목별 최신 1건 */
  latest: EquityRecord[]
  /** 특정 종목 전체 이력 */
  historyOf: (name: string) => EquityRecord[]
  save: (record: Omit<EquityRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  updateAcquisitionCost: (name: string, cost: number) => Promise<string | null>
  updateAvailableByName: (name: string, available: '가용' | '불가용') => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const { logAction } = useAuditLog()
  const [data, setData] = useState<EquityRecord[]>([])
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
    try {
      const { data: rows, error: err } = await restSelect<EquityRecord>(
        'equities', { match: { company: fetchCompany }, order: 'date.desc' },
      )
      if (fetchIdRef.current !== myId) return
      if (err) setError(err.message)
      else setData(rows ?? [])
    } catch (e) {
      if (fetchIdRef.current === myId) setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      if (fetchIdRef.current === myId) setLoading(false)
    }
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
    const isNew = !record.id
    const newId = generateUUID()
    let { error: err } = record.id
      ? await restUpdate('equities', record, { id: record.id })
      : await restInsert('equities', { ...record, id: newId })
    // 위 중복검사는 조회 시점의 클라이언트 스냅샷이라, 다른 탭·다른 사용자가 같은
    // 순간에 같은 기준일을 넣으면 둘 다 '없음'을 보고 둘 다 INSERT 한다(TOCTOU).
    // DB 유니크 인덱스가 그 경합을 막으면 여기로 23505 가 돌아온다 → 수정으로 전환.
    if (err && !record.id && isDuplicateKey(err.message)) {
      const { data: dup } = await restSelect<EquityRecord>('equities', {
        match: { company: record.company, name: record.name, date: record.date }, limit: 1,
      })
      const hit = dup?.[0]
      if (hit) {
        record = { ...record, id: hit.id }
        ;({ error: err } = await restUpdate('equities', record, { id: hit.id }))
      }
    }
    if (err) return err.message
    const company = record.company || fetchCompany || ''
    void logAction({ table: 'equities', action: isNew ? 'CREATE' : 'UPDATE', company, recordId: record.id ?? newId, summary: `${record.name ?? ''} ${record.date ?? ''} ${isNew ? '등록' : '수정'}` })
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restDelete('equities', { id })
    if (err) return err.message
    if (target) void logAction({ table: 'equities', action: 'DELETE', company: target.company, recordId: id, summary: `${target.name ?? ''} ${target.date ?? ''} 삭제`, before: target as unknown as Record<string, unknown> })
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  /** 같은 종목 전체 이력에 취득가액 일괄 반영 (name+company 매칭) */
  async function updateAcquisitionCost(name: string, cost: number): Promise<string | null> {
    if (!fetchCompany) return null
    const { error: err } = await restUpdate(
      'equities', { acquisition_cost: cost }, { name, company: fetchCompany },
    )
    if (err) return err.message
    setData(prev => prev.map(r => r.name === name ? { ...r, acquisition_cost: cost } : r))
    return null
  }

  /** 같은 종목 전체 이력에 가용/불가용 일괄 반영 (name+company 매칭) */
  async function updateAvailableByName(name: string, available: '가용' | '불가용'): Promise<string | null> {
    if (!fetchCompany) return null
    const { error: err } = await restUpdate(
      'equities', { available }, { name, company: fetchCompany },
    )
    if (err) return err.message
    setData(prev => prev.map(r => r.name === name ? { ...r, available } : r))
    void logAction({ table: 'equities', action: 'UPDATE', company: fetchCompany, recordId: name, summary: `${name} 가용현황 → ${available}` })
    return null
  }

  return { data, loading, error, refetch: fetch, latest, historyOf, save, remove, updateAcquisitionCost, updateAvailableByName }
}
