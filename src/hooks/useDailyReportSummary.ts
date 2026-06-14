/**
 * useDailyReportSummary — 자금일보 자금현황 테이블 데이터 훅
 *
 * 운용자금 분류:
 *   예금성  — 정기예금, 중금채
 *   비예금성 — 국채(단건), MMF, RP, 기타(전환사채 등)
 */
import { useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFx } from './useFx'
import { prevBizDay } from '../lib/bizDay'
import { calcBondValue } from '../lib/format'
import type { DailyRecord, InvestmentRecord, LoanRecord, EquityRecord, Company, FxCode } from '../types'

export interface ReportItem {
  id:           string
  report_id:    string
  direction:    'in' | 'out'
  category:     string
  amount:       number
  currency:     string
  amount_krw:   number | null
  linked_type:  string | null
  linked_id:    string | null
  memo:         string | null
  account_type: string | null   // krw_demand | krw_govt | krw_mmda | fx_usd | ...
}

/**
 * 운용자금 단위 항목
 * - 예금성(deposit)  : 정기예금, 중금채 → product별 합산
 * - 비예금성(non-deposit): 국채(1행/ticker), MMF, RP, 기타 → 합산
 *
 * 국채 특이사항 (T+1 API 제한):
 *   totalKrw  = 가장 최근 priceDate 기준가 평가액 → "당일잔액" 열 표시
 *   prevKrw   = 두 번째 최근 priceDate 기준가 평가액 → "전일잔액" 열 표시
 *   bondCurrDate / bondPrevDate = 각각의 실제 기준일 (툴팁 공지)
 */
export interface InvestGroup {
  product:       string
  label:         string
  currency:      string           // 'KRW' | 'USD' | 'EUR' ...
  totalKrw:      number           // 원화환산 합계 (소계용)
  totalRaw?:     number           // 외화 원본 금액 (FX 예금 표시용)
  prevKrw?:      number           // 전일잔액 KRW (국채 전용)
  prevRaw?:      number           // 전일잔액 외화 (FX 예금 전용)
  category:      'deposit' | 'non-deposit'
  isBondGroup?:  boolean
  bankLabel?:    string
  bondCurrDate?: string
  bondPrevDate?: string
  bondQtyMatch?: boolean
}

export interface LoanGroup {
  label:    string
  totalKrw: number
}

export interface EquityGroup {
  name:             string
  market:           string
  available:        '가용' | '불가용'
  totalValue:       number   // 당일(최신) 평가금액
  prevValue:        number   // 전일(직전) 평가금액 (없으면 당일과 동일)
  acquisitionCost:  number
  currShares:       number   // 당일 보유수량
  prevShares:       number   // 전일 보유수량 (없으면 당일과 동일)
}

export interface ItemSums {
  opIn:      number
  opOut:     number
  investIn:  number
  investOut: number
  loanIn:    number
  loanOut:   number
  evalIn:    number   // invest_eval_in 합계 (지분+국채 평가이익)
  evalOut:   number   // invest_eval_out 합계 (지분+국채 평가손실)
  /** account_type별 입출금 집계 (KRW 원화환산 + 외화 원본금액) */
  byAccount:    Record<string, { inKrw: number; outKrw: number; inRaw: number; outRaw: number }>
  /** 지분 종목명별 평가손익 (memo='@auto:종목명') */
  byEquityName: Record<string, { inKrw: number; outKrw: number }>
  /** 국채 종목명별 평가손익 (memo='@auto:bond:채권명') */
  byBondLabel:  Record<string, { inKrw: number; outKrw: number }>
}

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

// 예금성 product 목록
const DEPOSIT_PRODUCTS = new Set(['정기예금', '중금채'])


export function useDailyReportSummary() {
  const fx = useFx()

  const [prevDaily,    setPrevDaily]    = useState<DailyRecord | null>(null)
  const [currDaily,    setCurrDaily]    = useState<DailyRecord | null>(null)
  const [investments,  setInvestments]  = useState<InvestmentRecord[]>([])
  const [loans,        setLoans]        = useState<LoanRecord[]>([])
  const [equities,     setEquities]     = useState<EquityRecord[]>([])
  const [items,        setItems]        = useState<ReportItem[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')   // 보고서 날짜 (D-1)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const toKRW = useCallback((amount: number, currency: string): number => {
    if (!currency || currency === 'KRW') return amount
    return fx.toKRW(amount, currency as FxCode)
  }, [fx])

  // ── 데이터 패치 ──────────────────────────────────────────
  const fetch = useCallback(async (
    company: Company,
    date: string,      // 보고서 날짜 = 마감일 (D-1)
    reportId?: string,
  ) => {
    setLoading(true)
    setError(null)
    setSelectedDate(date)

    // date = 작성일(오늘). 마감잔액 = daily[date](오늘 입력 = 보고대상일 마감)
    // prev = 직전영업일 = daily[prev](직전영업일 입력 = 보고대상일 기초)
    const prev = prevBizDay(date)            // 기초일 (직전영업일 입력)
    const curr = date                           // 마감일 (작성일 = 오늘 입력)

    try {
      const [pRes, cRes, iRes, lRes, eRes] = await Promise.all([
        supabase.from('daily').select('*').eq('company', company).eq('date', prev).maybeSingle(),
        supabase.from('daily').select('*').eq('company', company).eq('date', curr).maybeSingle(),
        supabase.from('investments').select('*').eq('company', company).eq('active', true),
        supabase.from('loans').select('*').eq('company', company).eq('active', true),
        supabase.from('equities').select('*').eq('company', company).order('date', { ascending: false }),
      ])
      if (pRes.error) throw pRes.error
      if (cRes.error) throw cRes.error
      if (iRes.error) throw iRes.error
      if (lRes.error) throw lRes.error
      if (eRes.error) throw eRes.error

      setPrevDaily(pRes.data as DailyRecord | null)
      setCurrDaily(cRes.data as DailyRecord | null)
      setInvestments((iRes.data ?? []) as InvestmentRecord[])
      setLoans((lRes.data ?? []) as LoanRecord[])
      setEquities((eRes.data ?? []) as EquityRecord[])

      if (reportId) {
        const { data: itemData } = await supabase
          .from('daily_report_items')
          .select('*')
          .eq('report_id', reportId)
          .order('sort_order', { ascending: true })
        setItems((itemData ?? []) as ReportItem[])
      } else {
        setItems([])
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }

    if (!fx.rates.length) void fx.fetchRates()
  }, [fx])

  // ── 운용자금 집계 ─────────────────────────────────────────
  // 예금성: product + currency 조합별 분리 (KRW/외화 구분 표기)
  // 비예금성: 국채 ticker별 1행 (priceDate 최신 2건), 나머지 합산
  const investGroups = useMemo((): InvestGroup[] => {
    // 국채 거래일 기준일 = 보고 대상일(reportDate = 작성일 직전영업일)
    const reportDate = selectedDate ? prevBizDay(selectedDate) : ''
    // key: `${product}|${currency}` → { krw합계, raw합계, currency, product }
    const depositMap = new Map<string, { krw: number; raw: number; currency: string; product: string }>()
    const nonDepositMap = new Map<string, number>()
    const bondByTicker  = new Map<string, InvestmentRecord[]>()

    for (const inv of investments) {
      const ccy = (inv.currency || 'KRW').toUpperCase()

      if (inv.product === '국채') {
        const key = inv.bondTicker || inv.bondName || inv.bank || '국채_default'
        if (!bondByTicker.has(key)) bondByTicker.set(key, [])
        bondByTicker.get(key)!.push(inv)

      } else if (DEPOSIT_PRODUCTS.has(inv.product)) {
        const raw = inv.amount ?? 0
        const krw = toKRW(raw, ccy)
        const key = `${inv.product}|${ccy}`
        if (!depositMap.has(key)) depositMap.set(key, { krw: 0, raw: 0, currency: ccy, product: inv.product })
        const e = depositMap.get(key)!
        e.krw += krw
        e.raw += raw

      } else {
        const val = toKRW(inv.amount ?? 0, ccy)
        const key = ['MMF', 'RP'].includes(inv.product) ? inv.product : '기타'
        nonDepositMap.set(key, (nonDepositMap.get(key) ?? 0) + val)
      }
    }

    const result: InvestGroup[] = []
    const DEPOSIT_ORDER = ['정기예금', '중금채']
    const CCY_ORDER     = ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY']

    // 예금성 — product 순 × currency 순 (KRW 먼저, 외화 뒤)
    for (const p of DEPOSIT_ORDER) {
      const entries = [...depositMap.values()]
        .filter(v => v.product === p)
        .sort((a, b) => CCY_ORDER.indexOf(a.currency) - CCY_ORDER.indexOf(b.currency))
      for (const v of entries) {
        const isFx = v.currency !== 'KRW'
        result.push({
          product:  p,
          label:    isFx ? `${p} (${v.currency})` : p,
          currency: v.currency,
          totalKrw: v.krw,
          totalRaw: isFx ? v.raw : undefined,
          category: 'deposit',
        })
      }
    }
    // 그 외 예금성 (추가 product 있을 경우)
    for (const v of depositMap.values()) {
      if (!DEPOSIT_ORDER.includes(v.product)) {
        const isFx = v.currency !== 'KRW'
        result.push({
          product:  v.product,
          label:    isFx ? `${v.product} (${v.currency})` : v.product,
          currency: v.currency,
          totalKrw: v.krw,
          totalRaw: isFx ? v.raw : undefined,
          category: 'deposit',
        })
      }
    }

    // 비예금성 — 국채(ticker별 1행) 먼저
    // 거래일 기준: 보고대상일(reportDate) 이하 priceDate 최신 = 마감(curr), 그 이전 = 기초(prev)
    for (const [, recs] of bondByTicker) {
      recs.sort((a, b) => (b.priceDate ?? '').localeCompare(a.priceDate ?? ''))
      const dated = reportDate
        ? recs.filter(r => (r.priceDate ?? '') <= reportDate)
        : recs
      const curr = dated[0] ?? recs[0]
      const prev = dated[1] ?? recs[1]

      const currKrw = (curr.bondQty && curr.bondPrice)
        ? calcBondValue(curr.bondQty, curr.bondPrice)
        : toKRW(curr.amount ?? 0, curr.currency || 'KRW')
      const prevKrw = prev
        ? ((prev.bondQty && prev.bondPrice)
            ? calcBondValue(prev.bondQty, prev.bondPrice)
            : toKRW(prev.amount ?? 0, prev.currency || 'KRW'))
        : currKrw

      const bondLabel = curr.bondName || curr.bondTicker || curr.bank || '국채'
      result.push({
        product:      '국채',
        label:        bondLabel,
        currency:     'KRW',
        totalKrw:     currKrw,
        prevKrw:      prevKrw,
        category:     'non-deposit',
        isBondGroup:  true,
        bankLabel:    (curr.bondName || curr.bondTicker) ? (curr.bank || undefined) : undefined,
        bondCurrDate: curr.priceDate ?? undefined,
        bondPrevDate: prev?.priceDate ?? undefined,
        bondQtyMatch: !prev || (curr.bondQty ?? 0) === (prev.bondQty ?? 0),
      })
    }

    // MMF, RP, 기타
    for (const p of ['MMF', 'RP', '기타']) {
      if (nonDepositMap.has(p)) result.push({
        product: p, label: p, currency: 'KRW',
        totalKrw: nonDepositMap.get(p)!, category: 'non-deposit',
      })
    }

    return result
  }, [investments, toKRW, selectedDate])

  // 예금성/비예금성 소계
  const depositSubtotal    = useMemo(() => investGroups.filter(g => g.category === 'deposit').reduce((s, g) => s + g.totalKrw, 0), [investGroups])
  const nonDepositSubtotal = useMemo(() => investGroups.filter(g => g.category === 'non-deposit').reduce((s, g) => s + g.totalKrw, 0), [investGroups])

  // ── 차입금 집계 ──────────────────────────────────────────
  const loanGroups = useMemo((): LoanGroup[] => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() + 1)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    let short = 0, long = 0
    for (const l of loans) {
      if (l.maturity <= cutoffStr) short += l.amount
      else                          long  += l.amount
    }
    const result: LoanGroup[] = []
    if (short > 0) result.push({ label: '단기차입금', totalKrw: short })
    if (long  > 0) result.push({ label: '장기차입금', totalKrw: long  })
    if (result.length === 0 && loans.length > 0) {
      result.push({ label: '차입금', totalKrw: loans.reduce((s, l) => s + l.amount, 0) })
    }
    return result
  }, [loans])

  // ── 입출금 항목 집계 ──────────────────────────────────────
  const itemSums = useMemo((): ItemSums => {
    const krwAmt = (i: ReportItem) => i.amount_krw ?? toKRW(i.amount, i.currency)

    const byAccount:    Record<string, { inKrw: number; outKrw: number; inRaw: number; outRaw: number }> = {}
    const byEquityName: Record<string, { inKrw: number; outKrw: number }> = {}
    const byBondLabel:  Record<string, { inKrw: number; outKrw: number }> = {}

    for (const item of items) {
      // account_type별 집계 (KRW 환산 + 외화 원본금액)
      const acct = item.account_type
      if (acct) {
        if (!byAccount[acct]) byAccount[acct] = { inKrw: 0, outKrw: 0, inRaw: 0, outRaw: 0 }
        if (item.direction === 'in') { byAccount[acct].inKrw  += krwAmt(item); byAccount[acct].inRaw  += item.amount }
        else                         { byAccount[acct].outKrw += krwAmt(item); byAccount[acct].outRaw += item.amount }
      }

      // 지분 평가손익 — memo='@auto:종목명' 또는 category=invest_eval_*
      const isEval = item.category === 'invest_eval_in' || item.category === 'invest_eval_out'
      if (isEval) {
        const raw = item.memo?.startsWith('@auto:') ? item.memo.slice(6) : (item.memo ?? '기타')
        if (raw.startsWith('bond:')) {
          // 국채: '@auto:bond:채권명' → byBondLabel['채권명']
          const label = raw.slice(5)
          if (!byBondLabel[label]) byBondLabel[label] = { inKrw: 0, outKrw: 0 }
          if (item.direction === 'in') byBondLabel[label].inKrw  += krwAmt(item)
          else                         byBondLabel[label].outKrw += krwAmt(item)
        } else {
          // 지분: '@auto:종목명' → byEquityName['종목명']
          if (!byEquityName[raw]) byEquityName[raw] = { inKrw: 0, outKrw: 0 }
          if (item.direction === 'in') byEquityName[raw].inKrw  += krwAmt(item)
          else                         byEquityName[raw].outKrw += krwAmt(item)
        }
      }
    }

    return {
      opIn:      items.filter(i => i.direction === 'in').reduce((s, i) => s + krwAmt(i), 0),
      opOut:     items.filter(i => i.direction === 'out').reduce((s, i) => s + krwAmt(i), 0),
      investIn:  items.filter(i => i.direction === 'out' && i.category === 'invest_execute').reduce((s, i) => s + krwAmt(i), 0),
      investOut: items.filter(i => i.direction === 'in'  && i.category === 'invest_return' ).reduce((s, i) => s + krwAmt(i), 0),
      loanIn:    items.filter(i => i.direction === 'in'  && i.category === 'loan_drawdown' ).reduce((s, i) => s + krwAmt(i), 0),
      loanOut:   items.filter(i => i.direction === 'out' && i.category === 'loan_repayment').reduce((s, i) => s + krwAmt(i), 0),
      evalIn:    items.filter(i => i.category === 'invest_eval_in' ).reduce((s, i) => s + krwAmt(i), 0),
      evalOut:   items.filter(i => i.category === 'invest_eval_out').reduce((s, i) => s + krwAmt(i), 0),
      byAccount,
      byEquityName,
      byBondLabel,
    }
  }, [items, toKRW])

  // ── 운전자금 KRW 소계 (안A: fx_krw 사전계산값 사용 — 대시보드와 동일 공식) ──
  // fx_krw = InputPage 저장 시 그날 환율로 계산된 외화 원화환산 합계 (고정값)
  // FX 행별 표시는 fx_usd 등 raw 값을 그대로 사용하므로 표시에는 영향 없음
  const opTotal = useCallback((d: DailyRecord | null): number => {
    if (!d) return 0
    return (d.krw_demand ?? 0) + (d.krw_govt ?? 0) + (d.krw_mmda ?? 0) + (d.fx_krw ?? 0)
  }, [])

  // ── 지분·장기투자 집계 (안B) ──────────────────────────────
  // 대시보드 불가용자산 = equityUnavail + investUnavail + bondUnavail
  // 자금일보에는 지분(equities)만 별도 섹션으로 표시 (운용자금 불가용은 운용자금 섹션에 이미 포함)
  const equityGroups = useMemo((): EquityGroup[] => {
    // 거래일(종가 날짜) 기준: 보고 대상일(reportDate = 작성일 직전영업일) 이하 최신 = 마감(curr)
    //   마감 = reportDate 종가(6/9), 기초 = 그 이전 영업일 종가(6/8)
    const reportDate = selectedDate ? prevBizDay(selectedDate) : ''
    const byName = new Map<string, EquityRecord[]>()
    for (const e of equities) {
      if (!byName.has(e.name)) byName.set(e.name, [])
      byName.get(e.name)!.push(e)
    }
    return Array.from(byName.values()).map(recs => {
      recs.sort((a, b) => b.date.localeCompare(a.date))
      const dated = reportDate ? recs.filter(r => r.date <= reportDate) : recs
      const curr  = dated[0] ?? recs[0]   // 마감 (보고대상일 종가)
      const prev  = dated[1] ?? recs[1]   // 기초 (직전영업일 종가)
      return {
        name:            curr.name,
        market:          curr.market,
        available:       curr.available,
        totalValue:      curr.total_value    ?? 0,
        prevValue:       prev ? (prev.total_value ?? 0) : (curr.total_value ?? 0),
        acquisitionCost: curr.acquisition_cost ?? 0,
        currShares:      curr.shares ?? 0,
        prevShares:      prev ? (prev.shares ?? 0) : (curr.shares ?? 0),
      }
    })
  }, [equities, selectedDate])

  const equityUnavailTotal = useMemo(
    () => equityGroups.filter(g => g.available === '불가용').reduce((s, g) => s + g.acquisitionCost, 0),
    [equityGroups],
  )

  return {
    prevDaily, currDaily,
    investments, loans, items,
    investGroups, depositSubtotal, nonDepositSubtotal,
    loanGroups,
    equityGroups, equityUnavailTotal,
    itemSums,
    loading, error,
    fetch, fx, toKRW,
    opTotal,
    FX_CODES,
    selectedDate,   // 보고서 날짜 (마감일, D-1)
  }
}
