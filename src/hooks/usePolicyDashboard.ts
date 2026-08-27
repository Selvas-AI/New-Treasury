import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, DailyRecord, InvestmentRecord, LoanRecord, EquityRecord } from '../types'
import { calcBondValue } from '../lib/format'
import { normBank } from '../lib/bankUtils'
import { useFx } from './useFx'
import { getLatestEquities } from './useEquities'
import { getLatestBonds } from './useInvestments'
import { toKRWAmount, type FxCode } from '../lib/treasuryCalc'

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

  // 지분/장기투자 (가용)
  equityAvail: number

  // 차입금
  loans: LoanRecord[]
  totalLoan: number
  loanByBank: { bank: string; amount: number }[]   // 금융기관별 차입 집계

  // 총 자금 규모
  totalFundEstimate: number   // 운전자금+운용자금+국채 (정책 파라미터 없을 때 추정)

  // ── FX 정책 비교용 SSOT ──
  // fxRatio는 전 통화 외화자산(FIFO 잠금 포함) / 가용 자금 합계로 계산한다.
  // fxPolicyDenominator === totalFundAvail (2026-08-27~) — 대시보드 가용자금 합계와 동일.
  fxTotalHoldings: number
  totalFundAvail: number
  fxRatio: number
  /** 정책밴드용 전사 외화 바구니: 통화별 원금/원화환산(가용·잠금 모두 포함) */
  fxByCurrency: Record<FxCode, { nativeAmount: number; krwAmount: number }>
  fxPortfolioHoldings: number
  fxPolicyDenominator: number

  loading: boolean
}

interface RawCompanyData {
  daily: DailyRecord[]
  invest: InvestmentRecord[]
  loan: LoanRecord[]
  equity: EquityRecord[]
}

/** 한 법인의 raw 데이터 fetch (daily 최신1 + active 운용 + active 차입 + 지분 이력) */
async function fetchCompanyRaw(company: Company): Promise<RawCompanyData> {
  const [d, i, l, e] = await Promise.all([
    supabase.from('daily').select('*').eq('company', company)
      .order('date', { ascending: false }).limit(1),
    supabase.from('investments').select('*').eq('company', company).eq('active', true),
    supabase.from('loans').select('*').eq('company', company).eq('active', true),
    supabase.from('equities').select('*').eq('company', company).order('date', { ascending: false }),
  ])
  return {
    daily:  (d.data ?? []) as DailyRecord[],
    invest: (i.data ?? []).map(r => investFromDb(r as DbRow)),
    loan:   (l.data ?? []) as LoanRecord[],
    equity: (e.data ?? []) as EquityRecord[],
  }
}

type ToKRWFn = (amount: number, currency: string) => number
const identityKRW: ToKRWFn = (a) => a   // fallback when rates not loaded

/** raw 데이터 → PolicyRealData 집계 (단일/멀티 훅 공용) */
function computePolicyData(raw: RawCompanyData, loading: boolean, toKRW: ToKRWFn = identityKRW): PolicyRealData {
  const { daily: dailyData, invest: investData, loan: loanData, equity: equityData } = raw
  const latestDaily = dailyData[0] ?? null

  const operatingCash = latestDaily
    ? (latestDaily.krw_demand || 0) + (latestDaily.krw_govt || 0) + (latestDaily.krw_mmda || 0)
    : 0
  const fxKrw = latestDaily?.fx_krw || 0
  const operatingCashWithFx = operatingCash + fxKrw

  const nonBonds = investData.filter(i => i.product !== '국채')
  // 국채는 가격 갱신 시마다 날짜별 이력 row가 쌓이고 모두 active=true로 남음
  // → 종목(bondTicker/bondName)별 최신 priceDate 1건만 남겨야 중복 합산 방지 (FxPolicyTab과 동일 로직)
  const bonds    = getLatestBonds(investData)

  const toKRWAmt = (amount: number, currency: string) =>
    toKRWAmount(amount, currency, toKRW as (a: number, c: FxCode) => number)

  const investAvail   = nonBonds.filter(i => i.available === '가용')
    .reduce((s, i) => s + toKRWAmt(i.amount || 0, i.currency || 'KRW'), 0)
  const investUnavail = nonBonds.filter(i => i.available === '불가용')
    .reduce((s, i) => s + toKRWAmt(i.amount || 0, i.currency || 'KRW'), 0)

  const bondAvail = bonds.filter(i => i.available === '가용').reduce((s, i) => {
    const qty = i.bondQty ?? 0; const price = i.bondPrice ?? 0
    return s + (qty && price ? calcBondValue(qty, price) : (i.amount || 0))
  }, 0)

  const totalLoan = loanData.reduce((s, l) => s + toKRWAmt(l.amount || 0, l.currency || 'KRW'), 0)

  // 금융기관별 운용자금 집계 — 은행만, normBank로 계좌별 등록명 합산 (KRW 환산 기준)
  const bankMap = new Map<string, number>()
  nonBonds.forEach(i => {
    const key = normBank(i.bank)
    if (!key.includes('은행')) return
    bankMap.set(key, (bankMap.get(key) ?? 0) + toKRWAmt(i.amount || 0, i.currency || 'KRW'))
  })
  const investByBank = [...bankMap.entries()].map(([bank, amount]) => ({ bank, amount }))
    .sort((a, b) => b.amount - a.amount)

  // 금융기관별 차입금 집계
  const loanBankMap = new Map<string, number>()
  loanData.forEach(l => loanBankMap.set(l.lender, (loanBankMap.get(l.lender) ?? 0) + toKRWAmt(l.amount || 0, l.currency || 'KRW')))
  const loanByBank = [...loanBankMap.entries()].map(([bank, amount]) => ({ bank, amount }))
    .sort((a, b) => b.amount - a.amount)

  const totalFundEstimate = operatingCashWithFx + investAvail + investUnavail + bondAvail

  // 지분/장기투자 (가용) — 종목별 최신 1건만
  const equityAvail = getLatestEquities(equityData)
    .filter(e => e.available === '가용')
    .reduce((s, e) => s + (e.total_value || 0), 0)

  // FX 정책 SSOT: 정책밴드는 특정 통화가 아니라 전사 외화 바구니 / 전사 자금으로 계산한다.
  // daily.fx_usd 등은 외화 원금이며 fx_krw는 그 운전자금 외화 전체의 원화환산 합계다.
  const fxCodes: FxCode[] = ['USD','EUR','JPY','GBP','CNY']
  const dailyRecord = latestDaily as unknown as Record<string, unknown> | null
  const fxByCurrency = Object.fromEntries(fxCodes.map(code => {
    const operatingNative = Number(dailyRecord?.[`fx_${code.toLowerCase()}`] ?? 0)
    const investNative = nonBonds.filter(i => i.currency === code)
      .reduce((sum, i) => sum + (i.amount || 0), 0)
    const nativeAmount = operatingNative + investNative
    return [code, { nativeAmount, krwAmount: toKRWAmt(nativeAmount, code) }]
  })) as Record<FxCode, { nativeAmount: number; krwAmount: number }>
  const fxPortfolioHoldings = Object.values(fxByCurrency).reduce((sum, row) => sum + row.krwAmount, 0)
  // 총 자금 대비 외화 비율의 분모 = 가용 자금 합계 (2026-08-27 변경).
  // 불가용 운용자금(전환사채 등)은 현금성 자산이 아니라 정책밴드 분모에서 제외한다.
  // 국채·지분도 원래 가용분만 넣고 있었으므로 이 편이 일관되고, 대시보드 '가용자금 합계'와도
  // 같은 값이 된다(과거엔 운용만 불가용을 포함해 두 화면 비중이 25.9% vs 26.4%로 갈렸다).
  // ⚠ 분자(fxPortfolioHoldings)는 available 필터가 없다 — 현재 불가용 외화 보유가 0이라
  //    모집단이 일치하지만, 불가용 외화가 생기면 분자에서도 뺄지 재검토할 것.
  const totalFundAvail  = operatingCashWithFx + investAvail + bondAvail + equityAvail
  const fxPolicyDenominator = totalFundAvail
  const fxTotalHoldings = fxPortfolioHoldings
  const fxRatio = fxPolicyDenominator > 0 ? (fxPortfolioHoldings / fxPolicyDenominator) * 100 : 0

  return {
    latestDaily, operatingCash, operatingCashWithFx, fxKrw,
    investments: nonBonds, investAvail, investUnavail, investByBank,
    bonds, bondAvail, equityAvail, loans: loanData, totalLoan, loanByBank,
    totalFundEstimate, fxTotalHoldings, totalFundAvail, fxRatio,
    fxByCurrency, fxPortfolioHoldings, fxPolicyDenominator, loading,
  }
}

const EMPTY_RAW: RawCompanyData = { daily: [], invest: [], loan: [], equity: [] }

/** 특정 법인의 실데이터를 직접 fetching — auth company와 독립적 */
export function usePolicyDashboard(company: Company | null): PolicyRealData {
  const [raw, setRaw]         = useState<RawCompanyData>(EMPTY_RAW)
  const [loading, setLoading] = useState(false)
  const fx = useFx()
  const fetchFxRates = fx.fetchRates
  useEffect(() => { void fetchFxRates() }, [fetchFxRates])

  const fetch = useCallback(async () => {
    if (!company) { setRaw(EMPTY_RAW); return }
    setLoading(true)
    setRaw(await fetchCompanyRaw(company))
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  const toKRW = fx.toKRW as ToKRWFn
  return useMemo(() => computePolicyData(raw, loading, toKRW), [raw, loading, toKRW])
}

/**
 * 여러 법인의 실데이터를 한 훅에서 fetch — 동적 법인 목록 지원.
 * Rules of Hooks 준수: 내부에서 Promise.all 루프로 fetch (훅을 루프에서 호출하지 않음).
 */
export function usePolicyDashboards(companies: Company[]): Record<Company, PolicyRealData> {
  const [rawMap, setRawMap]   = useState<Record<Company, RawCompanyData>>({})
  const [loading, setLoading] = useState(false)
  const fx = useFx()
  const fetchFxRates = fx.fetchRates
  useEffect(() => { void fetchFxRates() }, [fetchFxRates])

  const key = companies.join('|')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (companies.length === 0) { setRawMap({}); return }
      setLoading(true)
      const entries = await Promise.all(
        companies.map(async c => [c, await fetchCompanyRaw(c)] as const),
      )
      if (cancelled) return
      setRawMap(Object.fromEntries(entries) as Record<Company, RawCompanyData>)
      setLoading(false)
    }
    void run()
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const toKRW = fx.toKRW as ToKRWFn
  return useMemo(() => {
    const out: Record<Company, PolicyRealData> = {}
    for (const c of companies) {
      out[c] = computePolicyData(rawMap[c] ?? EMPTY_RAW, loading, toKRW)
    }
    return out
  }, [rawMap, loading, key, toKRW]) // eslint-disable-line react-hooks/exhaustive-deps
}
