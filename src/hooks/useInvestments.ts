import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { restSelect, restInsert, restUpdate, restDelete, restUpdateIn } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAuditLog } from './useAuditLog'
import { generateUUID } from '../lib/format'
import type { Company, InvestmentRecord, UseQueryResult } from '../types'

// ── DB snake_case → TypeScript camelCase ─────────────────────────────────────
// Supabase는 DB 컬럼명(snake_case)을 그대로 반환하므로 수동 변환 필요
// start_date → start (& priceDate), bond_* → bond*
type DbRow = Record<string, unknown>

function fromDb(row: DbRow): InvestmentRecord {
  return {
    id:               row.id                as string,
    company:          row.company           as Company,
    bank:             row.bank              as string,
    product:          row.product           as string,
    currency:         row.currency          as string,
    amount:           (row.amount           as number)  ?? 0,
    available:        (row.available        as '가용' | '불가용') ?? '가용',
    rate:             (row.rate             as number)  ?? 0,
    start:            (row.start            as string)
                      ?? (row.start_date    as string)  ?? '',
    maturity:         (row.maturity         as string)  ?? '',
    active:           row.active            as boolean,
    bondName:         row.bond_name         as string  | undefined,
    bondTicker:       row.bond_ticker       as string  | undefined,
    bondQty:          row.bond_qty          as number  | undefined,
    bondPrice:        row.bond_price        as number  | undefined,
    // start_date 를 priceDate 로도 노출 (채권 기준일)
    priceDate:        (row.start_date       as string)
                      ?? (row.start        as string)  ?? undefined,
    acquisition_cost: (row.acquisition_cost as number)  ?? 0,
  }
}

// TypeScript camelCase → DB snake_case (insert / update 페이로드용)
function toDb(record: Partial<InvestmentRecord>): DbRow {
  const row: DbRow = { ...record }
  // insert 시 id가 undefined/null이면 DB auto-generate를 위해 제거
  if (!row.id) delete row.id
  // camelCase 필드를 snake_case로 이동
  if ('bondName'   in record) { row.bond_name   = record.bondName;   delete row.bondName   }
  if ('bondTicker' in record) { row.bond_ticker = record.bondTicker; delete row.bondTicker }
  if ('bondQty'    in record) { row.bond_qty    = record.bondQty;    delete row.bondQty    }
  if ('bondPrice'  in record) { row.bond_price  = record.bondPrice;  delete row.bondPrice  }
  // start → start_date (DB 실제 컬럼), priceDate는 DB 컬럼 없음 → 제거
  if ('start'      in record) { row.start_date  = record.start;      delete row.start      }
  if ('priceDate'  in record) {
    // priceDate 값을 start_date 로도 반영
    if (!row.start_date) row.start_date = record.priceDate
    delete row.priceDate
  }
  return row
}

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

export function useInvestments(activeOnly = false, companyOverride?: string): UseQueryResult<InvestmentRecord> & {
  bonds: InvestmentRecord[]
  nonBonds: InvestmentRecord[]
  save: (record: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
  setActive: (id: string, active: boolean) => Promise<string | null>
  updateAcquisitionCost: (ids: string[], cost: number) => Promise<string | null>
  updateAvailableById: (id: string, available: '가용' | '불가용') => Promise<string | null>
  updateAvailableByBondKey: (bondKey: string, available: '가용' | '불가용') => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const { logAction } = useAuditLog()
  const [data, setData] = useState<InvestmentRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : (companyOverride ?? currentCompany)

  // fetchCompany 변경 시 진행 중인 이전 요청 결과를 무시하기 위한 ref
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
      const { data: rows, error: err } = await restSelect<DbRow>(
        'investments', { match, order: 'maturity.asc' },
      )
      if (fetchIdRef.current !== myId) return  // 더 최신 요청이 있으면 데이터 반영 생략
      if (err) setError(err.message)
      else setData((rows ?? []).map(r => fromDb(r)))
    } catch (e) {
      if (fetchIdRef.current === myId) setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      if (fetchIdRef.current === myId) setLoading(false)
    }
  }, [fetchCompany, activeOnly])

  useEffect(() => { void fetch() }, [fetch])

  const bonds = useMemo(() => data.filter(i => i.product === '국채'), [data])
  const nonBonds = useMemo(() => data.filter(i => i.product !== '국채'), [data])

  async function save(record: Omit<InvestmentRecord, 'id'> & { id?: string }): Promise<string | null> {
    const isNew = !record.id
    const recordWithId = isNew ? { ...record, id: generateUUID() } : record
    const payload = toDb(recordWithId)
    const { error: err } = isNew
      ? await restInsert('investments', payload)
      : await restUpdate('investments', payload, { id: record.id! })
    if (err) return err.message
    const company = record.company || fetchCompany || ''
    const label = `${record.product ?? ''} ${record.bank ?? ''} ${record.amount ? record.amount.toLocaleString() + '원' : ''}`.trim()
    void logAction({ table: 'investments', action: isNew ? 'CREATE' : 'UPDATE', company, recordId: recordWithId.id as string, summary: isNew ? `${label} 신규 등록` : `${label} 수정`, after: record as unknown as Record<string, unknown> })
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restDelete('investments', { id })
    if (err) return err.message
    if (target) {
      const label = `${target.product ?? ''} ${target.bank ?? ''}`.trim()
      void logAction({ table: 'investments', action: 'DELETE', company: target.company, recordId: id, summary: `${label} 삭제`, before: target as unknown as Record<string, unknown> })
    }
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function setActive(id: string, active: boolean): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restUpdate('investments', { active }, { id })
    if (err) return err.message
    if (target) {
      const label = `${target.product ?? ''} ${target.bank ?? ''}`.trim()
      void logAction({ table: 'investments', action: 'SETACTIVE', company: target.company, recordId: id, summary: active ? `${label} 재활성화` : `${label} 만기처리` })
    }
    setData(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    return null
  }

  /** 과거 이력 일괄 취득가액 반영 */
  async function updateAcquisitionCost(ids: string[], cost: number): Promise<string | null> {
    const { error: err } = await restUpdateIn('investments', toDb({ acquisition_cost: cost }), 'id', ids)
    if (err) return err.message
    setData(prev => prev.map(r => ids.includes(r.id) ? { ...r, acquisition_cost: cost } : r))
    return null
  }

  /** 단건 가용/불가용 변경 */
  async function updateAvailableById(id: string, available: '가용' | '불가용'): Promise<string | null> {
    const target = data.find(r => r.id === id)
    const { error: err } = await restUpdate('investments', { available }, { id })
    if (err) return err.message
    setData(prev => prev.map(r => r.id === id ? { ...r, available } : r))
    if (target) {
      const label = `${target.product ?? ''} ${target.bank ?? ''}`.trim()
      void logAction({ table: 'investments', action: 'UPDATE', company: fetchCompany || '', recordId: id, summary: `${label} 가용현황 → ${available}` })
    }
    return null
  }

  /** 국채 종목(bondTicker/bondName/bank 기준) 전체 이력 일괄 가용/불가용 변경 — 지분의 updateAvailableByName과 동일 패턴 */
  async function updateAvailableByBondKey(bondKey: string, available: '가용' | '불가용'): Promise<string | null> {
    const ids = data
      .filter(r => r.product === '국채' && (r.bondTicker ?? r.bondName ?? r.bank) === bondKey)
      .map(r => r.id)
    if (ids.length === 0) return null
    const { error: err } = await restUpdateIn('investments', { available }, 'id', ids)
    if (err) return err.message
    setData(prev => prev.map(r => ids.includes(r.id) ? { ...r, available } : r))
    void logAction({ table: 'investments', action: 'UPDATE', company: fetchCompany || '', recordId: bondKey, summary: `${bondKey} 가용현황 → ${available}` })
    return null
  }

  return { data, loading, error, refetch: fetch, bonds, nonBonds, save, remove, setActive, updateAcquisitionCost, updateAvailableById, updateAvailableByBondKey }
}
