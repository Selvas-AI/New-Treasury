import { useMemo, useCallback } from 'react'
import { useDaily } from './useDaily'
import { useInvestments, getLatestInvestments, getLatestBonds } from './useInvestments'
import { useLoans } from './useLoans'
import { useEquities } from './useEquities'
import { useIssues, makeIssueKey } from './useIssues'
import { useFx } from './useFx'
import { calcReturn, calcBondValue, calcDday, isBusinessDay } from '../lib/format'

export interface BondSummary {
  name:             string
  isin:             string
  qty:              number
  price:            number
  value:            number    // calcBondValue(qty, price)
  priceDate:        string
  available:        '가용' | '불가용'
  acquisition_cost: number
}

export interface WaterfallItem {
  label: string
  value: number          // 원화
  sign: '+' | '-' | '='
  sub?: string           // 보조 설명
}

export interface KpiData {
  availableCash: number       // 가용자금 합계
  netCashPosition: number     // 순현금 포지션
  unavailableAssets: number   // 불가용 자산
  operatingCash: number       // 운전자금 가용
  investCash: number          // 운용자금 가용 (비국채)
  bondCash: number            // 국채 가용
  totalLoan: number           // 차입금 합계
}

export interface IssueItem {
  key: string
  title: string
  desc: string
  status: 'open' | 'review' | 'done'
  commentCount: number
}

export function useDashboard() {
  const daily    = useDaily()
  const invest   = useInvestments(true)    // active only
  const loans    = useLoans(true)          // active only
  const equities = useEquities()
  const issues   = useIssues()
  const fx       = useFx()

  const loading = daily.loading || invest.loading || loans.loading || equities.loading

  // ─── 운전자금 최신 1건 ───────────────────────────────────
  const latestDaily = useMemo(() => {
    if (!daily.data.length) return null
    return daily.data[0]   // 날짜 내림차순 정렬되어 있음
  }, [daily.data])

  // ─── 운용자금 최신 집계 ──────────────────────────────────
  const latestInvests = useMemo(
    () => getLatestInvestments(invest.data),
    [invest.data],
  )

  // ─── 워터폴 + KPI ────────────────────────────────────────
  const kpi = useMemo<KpiData>(() => {
    // 운전자금
    const d = latestDaily
    const operatingCash = d
      ? (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)
      : 0

    // 운용자금
    const investAvail = latestInvests
      .filter(i => i.product !== '국채' && i.available === '가용')
      .reduce((s, i) => s + (i.amount || 0), 0)

    const investUnavail = latestInvests
      .filter(i => i.product !== '국채' && i.available === '불가용')
      .reduce((s, i) => s + (i.amount || 0), 0)

    // 국채
    const bondAvail = latestInvests
      .filter(i => i.product === '국채' && i.available === '가용')
      .reduce((s, i) => {
        const v = i.bondQty && i.bondPrice
          ? calcBondValue(i.bondQty, i.bondPrice)
          : (i.amount || 0)
        return s + v
      }, 0)

    const bondUnavail = latestInvests
      .filter(i => i.product === '국채' && i.available === '불가용')
      .reduce((s, i) => {
        const v = i.bondQty && i.bondPrice
          ? calcBondValue(i.bondQty, i.bondPrice)
          : (i.amount || 0)
        return s + v
      }, 0)

    // 차입금
    const totalLoan = loans.data.reduce((s, l) => s + (l.amount || 0), 0)

    // 지분 불가용 (취득가액 기준)
    const equityUnavail = equities.latest
      .filter(e => e.available === '불가용')
      .reduce((s, e) => s + (e.total_value || 0), 0)

    const availableCash   = operatingCash + investAvail + bondAvail
    const netCashPosition = availableCash - totalLoan
    const unavailableAssets = investUnavail + bondUnavail + equityUnavail

    return {
      availableCash,
      netCashPosition,
      operatingCash,
      investCash: investAvail,
      bondCash: bondAvail,
      totalLoan,
      unavailableAssets,
    }
  }, [latestDaily, latestInvests, loans.data, equities.latest])

  const waterfall = useMemo<WaterfallItem[]>(() => [
    { label: '운전자금 (가용)',   value: kpi.operatingCash, sign: '+' },
    { label: '운용자금 (가용)',   value: kpi.investCash,    sign: '+' },
    { label: '국채 (가용)',       value: kpi.bondCash,      sign: '+' },
    { label: '차입금',            value: kpi.totalLoan,     sign: '-' },
    { label: '순현금 포지션',     value: kpi.netCashPosition, sign: '=' },
  ], [kpi])

  // ─── 이슈 감지 ───────────────────────────────────────────
  const detectedIssues = useMemo<IssueItem[]>(() => {
    const result: IssueItem[] = []

    // 1. 오늘 운전자금 미입력 (영업일만)
    if (isBusinessDay()) {
      const today = new Date().toISOString().slice(0, 10)
      const todayInput = daily.data.find(d => d.date === today)
      if (!todayInput) {
        const key = makeIssueKey('input_daily')
        const thread = issues.threadOf(key)
        const lastStatus = thread[thread.length - 1]?.status ?? 'open'
        if (lastStatus !== 'done') {
          result.push({
            key,
            title: '운전자금 미입력',
            desc: `오늘(${today}) 운전자금이 아직 입력되지 않았습니다.`,
            status: lastStatus,
            commentCount: thread.length,
          })
        }
      }
    }

    // 2. 차입금 만기 D-90 이하 (만기 경과 포함)
    for (const loan of loans.data) {
      const dday = calcDday(loan.maturity)
      if (dday <= 90) {
        const key = makeIssueKey('loan', loan.id)
        const thread = issues.threadOf(key)
        const lastStatus = thread[thread.length - 1]?.status ?? 'open'
        if (lastStatus !== 'done') {
          const ddayLabel = dday < 0
            ? `만기경과 D+${Math.abs(dday)}`
            : `D-${dday}`
          result.push({
            key,
            title: `차입금 만기 ${ddayLabel}`,
            desc: `${loan.lender} ${loan.type} ${(loan.amount / 1_0000_0000).toFixed(0)}억 — ${loan.maturity} 만기`,
            status: lastStatus,
            commentCount: thread.length,
          })
        }
      }
    }

    // 3. 지분 주가 미갱신 2일 이상
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const threshold = twoDaysAgo.toISOString().slice(0, 10)

    for (const eq of equities.latest.filter(e => e.market !== '비상장')) {
      if (!eq.date || eq.date < threshold) {
        const key = makeIssueKey('equity', eq.name)
        const thread = issues.threadOf(key)
        const lastStatus = thread[thread.length - 1]?.status ?? 'open'
        if (lastStatus !== 'done') {
          result.push({
            key,
            title: `주가 미갱신 — ${eq.name}`,
            desc: `마지막 갱신: ${eq.date || '없음'}`,
            status: lastStatus,
            commentCount: thread.length,
          })
        }
      }
    }

    return result
  }, [daily.data, loans.data, equities.latest, issues])

  // ─── 전일 운전자금 (전일 대비 표시용) ────────────────────
  const prevOperatingCash = useMemo(() => {
    if (daily.data.length < 2) return null
    const prev = daily.data[1]   // 날짜 내림차순 정렬 → [0]=오늘, [1]=전일
    return (prev.krw_demand || 0) + (prev.krw_govt || 0) + (prev.krw_mmda || 0) + (prev.fx_krw || 0)
  }, [daily.data])

  // ─── 지분 수익률 ─────────────────────────────────────────
  const equityReturns = useMemo(() =>
    equities.latest.map(e => ({
      ...e,
      returnRate: calcReturn(e.total_value, e.acquisition_cost),
    })),
  [equities.latest])

  // ─── 국채 최신 시세 ──────────────────────────────────────
  const latestBonds = useMemo<BondSummary[]>(() =>
    getLatestBonds(invest.data).map(b => {
      const qty   = b.bondQty   ?? 0
      const price = b.bondPrice ?? 0
      return {
        name:             b.bondName ?? b.bank,
        isin:             b.bondTicker ?? '',
        qty,
        price,
        value:            qty && price ? calcBondValue(qty, price) : (b.amount ?? 0),
        priceDate:        b.priceDate ?? b.start ?? '',
        available:        b.available,
        acquisition_cost: b.acquisition_cost ?? 0,
      }
    }),
  [invest.data])

  // ─── 국채 ISIN별 평가금액 이력 ───────────────────────────
  const bondHistoryOf = useCallback((isin: string): { date: string; value: number }[] =>
    invest.data
      .filter(r => r.product === '국채' && r.bondTicker === isin)
      .map(r => {
        const qty   = r.bondQty   ?? 0
        const price = r.bondPrice ?? 0
        return {
          date:  r.priceDate ?? r.start ?? '',
          value: qty && price ? calcBondValue(qty, price) : (r.amount ?? 0),
        }
      })
      .filter(r => r.date)
      .sort((a, b) => a.date.localeCompare(b.date)),
  [invest.data])

  return {
    loading,
    fx,
    kpi,
    waterfall,
    latestDaily,
    allDailyData: daily.data,      // ← 전체 운전자금 이력 (차트용)
    latestInvests,
    allInvestData: invest.data,    // ← 전체 운용자금 데이터
    loans: loans.data,
    detectedIssues,
    equityReturns,
    equityHistoryOf: equities.historyOf,  // ← 지분 종목별 이력 (스파크라인용)
    latestBonds,                          // ← 국채 최신 시세
    bondHistoryOf,                        // ← 국채 ISIN별 평가금액 이력
    prevOperatingCash,                    // ← 전일 운전자금 (전일 대비용)
    issues,
    refetchAll: () => {
      void daily.refetch()
      void invest.refetch()
      void loans.refetch()
      void equities.refetch()
      void issues.refetch()
    },
  }
}
