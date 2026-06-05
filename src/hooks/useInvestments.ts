import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
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
    setData([])
    setError(null)
    let query = supabase
      .from('investments')
      .select('*')
      .eq('company', fetchCompany)
      .order('maturity', { ascending: true })
    if (activeOnly) query = query.eq('active', true)
    const { data: rows, error: err } = await query
    if (err) setError(err.message)
    else setData((rows ?? []).map(r => fromDb(r as DbRow)))
    setLoading(false)
  }, [fetchCompany, activeOnly])

  useEffect(() => { void fetch() }, [fetch])

  const bonds = useMemo(() => data.filter(i => i.product === '국채'), [data])
  const nonBonds = useMemo(() => data.filter(i => i.product !== '국채'), [data])

  async function save(record: Omit<InvestmentRecord, 'id'> & { id?: string }): Promise<string | null> {
    const payload = toDb(record)
    const { error: err } = record.id
      ? await supabase.from('investments').update(payload).eq('id', record.id)
      : await supabase.from('investments').insert(payload)
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
      .update(toDb({ acquisition_cost: cost }))
      .in('id', ids)
    if (err) return err.message
    setData(prev => prev.map(r => ids.includes(r.id) ? { ...r, acquisition_cost: cost } : r))
    return null
  }

  return { data, loading, error, refetch: fetch, bonds, nonBonds, save, remove, setActive, updateAcquisitionCost }
}
