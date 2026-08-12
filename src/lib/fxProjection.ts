import { runBacktest, type BacktestInput, type BacktestResult } from './fxBacktest'
import type { RegimeSeriesPoint } from './fxRegime'

export type FxProjectionScenario = 'flat' | 'up' | 'down' | 'replay'

export interface FxProjectionInput extends Omit<BacktestInput, 'series' | 'startDate'> {
  history: RegimeSeriesPoint[]
  months: number
  scenario: FxProjectionScenario
  annualMovePct?: number
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

  for (let i = 0; i < days; i++) {
    date = nextBusinessDate(date)
    if (scenario === 'replay' && returns.length) rate *= 1 + returns[i % returns.length]
    else rate *= 1 + dailyTrend
    result.push({ date: isoDate(date), rate: Math.max(1, rate) })
  }
  return result
}

export function runProjection(input: FxProjectionInput): FxProjectionResult {
  const { history, months, scenario, annualMovePct = 8, ...backtest } = input
  if (!history.length) {
    return { result: runBacktest({ ...backtest, series: [], startDate: '' }), projectedSeries: [],
      startDate: '', openingLotClearedDate: null, bookRateNormalizedDate: null, totalPnlBreakEvenDate: null }
  }
  const startDate = history[history.length - 1].date
  const projectedSeries = buildProjectionSeries(history, months, scenario, annualMovePct)
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
