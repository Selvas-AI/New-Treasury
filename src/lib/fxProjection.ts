import { runBacktest, type BacktestInput, type BacktestResult } from './fxBacktest'
import { bizDaysBetween } from './bizDay'
import type { RegimeSeriesPoint } from './fxRegime'

export type FxProjectionScenario = 'flat' | 'up' | 'down' | 'replay'

export interface FxProjectionInput extends Omit<BacktestInput, 'series' | 'startDate'> {
  history: RegimeSeriesPoint[]
  months: number
  scenario: FxProjectionScenario
  annualMovePct?: number
  /** true 면 매 호출마다 다른 무작위 경로가 생성된다(추세는 유지, 일별 흔들림만 무작위). */
  randomize?: boolean
  /** 연환산 변동성(%) — randomize 시 흔들림 크기. 미지정 시 최근 1년 실현 변동성 사용 */
  volatilityPct?: number
}

/** 최근 1년(최대 253영업일) 실현 변동성을 연환산 %로 — 변동성 입력의 기본값으로 사용 */
export function historicalAnnualVolPct(history: RegimeSeriesPoint[]): number {
  const window = history.slice(-253)
  if (window.length < 10) return 8
  const rets = window.slice(1).map((p, i) => {
    const prev = window[i].rate
    return prev > 0 ? Math.log(p.rate / prev) : 0
  })
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length
  return Math.sqrt(variance) * Math.sqrt(252) * 100
}

/** 표준정규분포 난수 (Box–Muller) */
function randNormal(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface FxProjectionResult {
  result: BacktestResult
  projectedSeries: RegimeSeriesPoint[]
  startDate: string
  openingLotClearedDate: string | null
  bookRateNormalizedDate: string | null
  totalPnlBreakEvenDate: string | null
}

function nextBusinessDate(date: Date): Date {
  const next = new Date(date)
  do next.setUTCDate(next.getUTCDate() + 1)
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
  return next
}

function isoDate(date: Date) { return date.toISOString().slice(0, 10) }

/** 미래 예측이 아니라 사용자가 선택한 가정 경로를 만든다. */
export function buildProjectionSeries(
  history: RegimeSeriesPoint[],
  months: number,
  scenario: FxProjectionScenario,
  annualMovePct = 8,
  opts?: { randomize?: boolean; volatilityPct?: number },
): RegimeSeriesPoint[] {
  if (!history.length) return []
  const days = Math.max(20, Math.round(Math.max(1, months) * 20))
  const result = [...history]
  const replayWindow = history.slice(-253)
  const returns = replayWindow.slice(1).map((point, i) => {
    const prev = replayWindow[i]?.rate ?? point.rate
    return prev > 0 ? point.rate / prev - 1 : 0
  })
  let rate = history[history.length - 1].rate
  let date = new Date(`${history[history.length - 1].date}T00:00:00Z`)
  const sign = scenario === 'up' ? 1 : scenario === 'down' ? -1 : 0
  const dailyTrend = Math.pow(1 + sign * Math.abs(annualMovePct) / 100, 1 / 240) - 1

  const randomize = opts?.randomize ?? false
  const dailyVol = (opts?.volatilityPct ?? historicalAnnualVolPct(history)) / 100 / Math.sqrt(252)
  // replay 는 실제 과거 등락을 그대로 쓰므로 매번 다른 시작 위치에서 순환시키는 것만으로 무작위 경로가 된다.
  const replayOffset = randomize && returns.length ? Math.floor(Math.random() * returns.length) : 0

  for (let i = 0; i < days; i++) {
    date = nextBusinessDate(date)
    if (scenario === 'replay' && returns.length) {
      rate *= 1 + returns[(i + replayOffset) % returns.length]
    } else {
      rate *= 1 + dailyTrend
      if (randomize) rate *= 1 + randNormal() * dailyVol
    }
    result.push({ date: isoDate(date), rate: Math.max(1, rate) })
  }
  return result
}

export function runProjection(input: FxProjectionInput): FxProjectionResult {
  const { history, months, scenario, annualMovePct = 8, randomize, volatilityPct, ...backtest } = input
  if (!history.length) {
    return { result: runBacktest({ ...backtest, series: [], startDate: '' }), projectedSeries: [],
      startDate: '', openingLotClearedDate: null, bookRateNormalizedDate: null, totalPnlBreakEvenDate: null }
  }
  const startDate = history[history.length - 1].date
  const projectedSeries = buildProjectionSeries(history, months, scenario, annualMovePct, { randomize, volatilityPct })
  const result = runBacktest({ ...backtest, series: projectedSeries, startDate })
  const futurePoints = result.points.slice(1)
  return {
    result,
    projectedSeries,
    startDate,
    openingLotClearedDate: futurePoints.find(p => (p.openingLotRemainingFx ?? 1) <= 1e-6)?.date ?? null,
    bookRateNormalizedDate: futurePoints.find(p => p.fifoBookRate != null && Math.abs(p.fifoBookRate - p.rate) / p.rate <= 0.01)?.date ?? null,
    totalPnlBreakEvenDate: futurePoints.find(p => p.fifoTotalPnlKRW != null && p.fifoTotalPnlKRW >= 0)?.date ?? null,
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export interface MonteCarloBandPoint {
  date: string
  pnlP10: number | null
  pnlP50: number | null
  pnlP90: number | null
}

export interface MonteCarloResult {
  runs: number
  /** 기간 내 장부환율이 정상화(시장가 ±1%)에 도달한 경로 수 */
  normalizedCount: number
  /** 기간 내 총손익이 0 이상에 도달한 경로 수 */
  breakEvenCount: number
  /** 정상화까지 걸린 개월(도달한 경로만 평균, 20영업일=1개월) */
  avgNormalizedMonths: number | null
  /** 총손익 흑자 전환까지 걸린 개월(도달한 경로만 평균) */
  avgBreakEvenMonths: number | null
  /** 날짜별 총손익 p10/p50/p90 밴드 — 경로들이 얼마나 넓게 갈렸는지 보여준다 */
  band: MonteCarloBandPoint[]
}

/**
 * 무작위 반복 실행 결과 draws 를 p10/p50/p90 밴드와 도달 확률로 요약한다.
 * ⚠ 백테스트 1회도 가볍지 않아(전체 이력을 매 점검일마다 다시 계산) N회를 한
 *   번에 동기 실행하면 메인 스레드가 수 초~수십 초 멈춰 브라우저가 "다운된
 *   것처럼" 보인다(2026-08-13 사용자 리포트). 그래서 draws 생성은 호출부
 *   (BacktestTab)에서 한 틱씩 양보하며 만들고, 이 함수는 순수 집계만 한다.
 */
export function summarizeMonteCarloDraws(draws: FxProjectionResult[]): MonteCarloResult {
  const valid = draws.filter(d => d.result.points.length > 1)

  const normalized = valid.filter(d => d.bookRateNormalizedDate)
  const brokeEven = valid.filter(d => d.totalPnlBreakEvenDate)
  const avgMonths = (dates: (string | null)[], starts: string[]) => {
    const months = dates.map((d, i) => d == null ? null : bizDaysBetween(starts[i], d) / 20).filter((v): v is number => v != null)
    return months.length ? months.reduce((s, v) => s + v, 0) / months.length : null
  }

  const len = valid.length ? Math.min(...valid.map(d => d.result.points.length)) : 0
  const band: MonteCarloBandPoint[] = []
  for (let i = 0; i < len; i++) {
    const date = valid[0].result.points[i].date
    const pnls = valid
      .map(d => d.result.points[i].fifoTotalPnlKRW)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)
    band.push({ date, pnlP10: percentile(pnls, 0.1), pnlP50: percentile(pnls, 0.5), pnlP90: percentile(pnls, 0.9) })
  }

  return {
    runs: valid.length,
    normalizedCount: normalized.length,
    breakEvenCount: brokeEven.length,
    avgNormalizedMonths: avgMonths(normalized.map(d => d.bookRateNormalizedDate), normalized.map(d => d.startDate)),
    avgBreakEvenMonths: avgMonths(brokeEven.map(d => d.totalPnlBreakEvenDate), brokeEven.map(d => d.startDate)),
    band,
  }
}
