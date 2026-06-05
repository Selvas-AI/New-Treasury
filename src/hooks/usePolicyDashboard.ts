import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, DailyRecord, InvestmentRecord, LoanRecord } from '../types'
import { calcBondValue } from '../lib/format'

// ── DB row → InvestmentRecord (간소화 버전) ───────────────────────────────
type DbRow = Record<string, unknown>
function investFromDb(row: DbRow): InvestmentRecord {
  return {
    id:               row.id               as string,
    company:          row.company          as Company,
    bank:             row.bank             as string,
    product:          row.product          as string,
    currency:         row.currency         as string,
    amount:           (row.amount          as number) ?? 0,
    available:        (row.available       as '가용' | '불가용') ?? '가용',
    rate:             (row.rate            as number) ?? 0,
    start:            (row.start_date      as string) ?? (row.start as string) ?? '',
    maturity:         (row.maturity        as string) ?? '',
    active:           row.active           as boolean,
    bondName:         row.bond_name        as string | undefined,
    bondTicker:       row.bond_ticker      as string | undefined,
    bondQty:          row.bond_qty         as number | undefined,
    bondPrice:        row.bond_price       as number | undefined,
    priceDate:        (row.start_date      as string) ?? undefined,
    acquisition_cost: (row.acquisition_cost as number) ?? 0,
  }
}

export interface PolicyRealData {
  // 운전자금
  latestDaily: DailyRecord | null
  operatingCash: number       // krw_demand + krw_govt + krw_mmda (원화현금성)
  operatingCashWithFx: number // 위 + fx_krw
  fxKrw: number

  // 운용자금 (비국채, active)
  investments: InvestmentRecord[]
  investAvail: number
  investUnavail: number
  investByBank: { bank: string; amount: number }[]  // 금융기관별 집계

  // 국채
  bonds: InvestmentRecord[]
  bondAvail: number

  // 차입금
  loans: LoanRecord[]
  totalLoan: number
  loanByBank: { bank: string; amount: number }[]   // 금융기관별 차입 집계

  // 총 자금 규모
  totalFundEstimate: number   // 운전자금+운용자금+국채 (정책 파라미터 없을 때 추정)

  loading: boolean
}

/** 특정 법인의 실데이터를 직접 fetching — auth company와 독립적 */
export function usePolicyDashboard(company: Company | null): PolicyRealData {
  const [dailyData, setDailyData]   = useState<DailyRecord[]>([])
  const [investData, setInvestData] = useState<InvestmentRecord[]>([])
  const [loanData, setLoanData]     = useState<LoanRecord[]>([])
  const [loading, setLoading]       = useState(false)

  const fetch = useCallback(async () => {
    if (!company) {
      setDailyData([]); setInvestData([]); setLoanData([])
      return
    }
    setLoading(true)
    const [d, i, l] = await Promise.all([
      supabase.from('daily').select('*').eq('company', company)
        .order('date', { ascending: false }).limit(1),
      supabase.from('investments').select('*').eq('company', company)
        .eq('active', true),
      supabase.from('loans').select('*').eq('company', company)
        .eq('active', true),
    ])
    setDailyData((d.data ?? []) as DailyRecord[])
    setInvestData((i.data ?? []).map(r => investFromDb(r as DbRow)))
    setLoanData((l.data ?? []) as LoanRecord[])
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  return useMemo<PolicyRealData>(() => {
    const latestDaily = dailyData[0] ?? null

    const operatingCash = latestDaily
      ? (latestDaily.krw_demand || 0) + (latestDaily.krw_govt || 0) + (latestDaily.krw_mmda || 0)
      : 0
    const fxKrw = latestDaily?.fx_krw || 0
    const operatingCashWithFx = operatingCash + fxKrw

    const nonBonds = investData.filter(i => i.product !== '국채')
    const bonds    = investData.filter(i => i.product === '국채')

    const investAvail   = nonBonds.filter(i => i.available === '가용').reduce((s, i) => s + (i.amount || 0), 0)
    const investUnavail = nonBonds.filter(i => i.available === '불가용').reduce((s, i) => s + (i.amount || 0), 0)

    const bondAvail = bonds.filter(i => i.available === '가용').reduce((s, i) => {
      const qty = i.bondQty ?? 0; const price = i.bondPrice ?? 0
      return s + (qty && price ? calcBondValue(qty, price) : (i.amount || 0))
    }, 0)

    const totalLoan = loanData.reduce((s, l) => s + (l.amount || 0), 0)

    // 금융기관별 운용자금 집계
    const bankMap = new Map<string, number>()
    nonBonds.forEach(i => bankMap.set(i.bank, (bankMap.get(i.bank) ?? 0) + (i.amount || 0)))
    const investByBank = [...bankMap.entries()].map(([bank, amount]) => ({ bank, amount }))
      .sort((a, b) => b.amount - a.amount)

    // 금융기관별 차입금 집계
    const loanBankMap = new Map<string, number>()
    loanData.forEach(l => loanBankMap.set(l.lender, (loanBankMap.get(l.lender) ?? 0) + (l.amount || 0)))
    const loanByBank = [...loanBankMap.entries()].map(([bank, amount]) => ({ bank, amount }))
      .sort((a, b) => b.amount - a.amount)

    const totalFundEstimate = operatingCashWithFx + investAvail + investUnavail + bondAvail

    return {
      latestDaily,
      operatingCash,
      operatingCashWithFx,
      fxKrw,
      investments: nonBonds,
      investAvail,
      investUnavail,
      investByBank,
      bonds,
      bondAvail,
      loans: loanData,
      totalLoan,
      loanByBank,
      totalFundEstimate,
      loading,
    }
  }, [dailyData, investData, loanData, loading])
}
