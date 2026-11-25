/**
 * fxBandReview — 리밸런싱 기준(기본 3%p) 회고 리포트 (2026-11-25 결정 D5)
 *
 * 목적: "3%p 가 적정한가"를 정책회의에서 판단할 수 있게, 과거 여러 기간에
 *   기준 1~5%p 를 똑같은 조건으로 돌린 결과를 한 번에 묶는다.
 *
 * ⚠ 계산은 runBacktest(실전 규칙: 밴드 미만 보류 · 분기 손실 한도)를 그대로 쓴다.
 *   이 모듈은 기간을 나누고 결과를 비교·요약할 뿐이다.
 *
 * ⚠ 비교 지표 — **총가치 = 환전 실현액 + 기말 미환전 평가액**.
 *   평균 실현환율만 보면 "덜 판 기준"이 고점에서 조금만 팔아 유리해 보인다.
 *   유입·시작 재고가 모든 기준에 같으므로, 기말에 남은 외화까지 같은 날 환율로 평가해야 공정하다.
 *
 * ⚠ 시작 재고·자금 규모·월 유입은 **오늘 입력값을 과거에 놓은 가정**이다(규칙 검증 탭과 같음).
 *   금액보다 **기준 간 차이와 순위**를 읽는다.
 */
import { runBacktest, type BacktestInput, type BacktestResult } from './fxBacktest'
import type { RegimeSeriesPoint } from './fxRegime'

export const REVIEW_BANDS = [0.01, 0.02, 0.03, 0.04, 0.05] as const

/** 현행과 최선의 총가치 차이가 이 비율(총가치 대비) 이내면 "사실상 같음"으로 본다 */
export const NEAR_BEST_PCT = 0.0005   // 0.05%

/** 연 환산 거래 횟수가 이보다 많으면 실무 부담 경고 (격주 1회 수준) */
export const BUSY_TRADES_PER_YEAR = 26

export interface ReviewPeriodDef { key: string; label: string; months: number }

export const REVIEW_PERIODS: ReviewPeriodDef[] = [
  { key: '6m', label: '최근 6개월', months: 6 },
  { key: '1y', label: '최근 1년',   months: 12 },
  { key: '2y', label: '최근 2년',   months: 24 },
  { key: '3y', label: '최근 3년',   months: 36 },
]

export interface ActualSale { date: string; amountFx: number; rate: number }

export interface BandReviewInput {
  base: Omit<BacktestInput, 'startDate' | 'protocol'>
  protocol: BacktestInput['protocol']
  /** 회사 실제 매각(완료·매도·같은 통화) — 기간별 비교용 */
  actualSales?: ActualSale[]
  currency: string
}

export interface BandReviewRow {
  band: number
  totalValueKRW: number
  realizedKRW: number
  endingValueKRW: number
  endingHoldingFx: number
  weightedAverageRate: number | null
  ratePremium: number | null
  tradeCount: number
  tradesPerYear: number
  heldByBandChecks: number
  cappedByLossTrades: number
  maxExposureKRW: number
  /** 이 기간 안 순위 (총가치 1위 = 1) */
  rank: number
  /** 최선 대비 총가치 차이(원, ≤ 0) */
  gapToBestKRW: number
}

export interface BandReviewPeriod {
  key: string
  label: string
  startDate: string
  endDate: string
  years: number
  periodAverageRate: number
  rows: BandReviewRow[]
  bestBand: number
  current: BandReviewRow
  /** 현행이 최선과 사실상 같은가 (NEAR_BEST_PCT 이내) */
  currentNearBest: boolean
  actual: { count: number; amountFx: number; weightedRate: number | null } | null
}

export type BandReviewConclusion = 'keep' | 'review' | 'insufficient'

export interface BandReviewReport {
  currency: string
  currentBand: number
  asOf: string
  periods: BandReviewPeriod[]
  /** 기준별 1위 횟수 */
  winsByBand: Record<string, number>
  conclusion: BandReviewConclusion
  /** 재검토일 때 제안 기준 */
  suggestedBand: number | null
  /** 사람이 읽는 근거 문장들 */
  reasons: string[]
  assumptions: string
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

const bandKey = (b: number) => `${Math.round(b * 100)}`
export const bandLabel = (b: number) => `${Math.round(b * 100)}%p`

function rowFrom(band: number, r: BacktestResult, years: number): Omit<BandReviewRow, 'rank' | 'gapToBestKRW'> {
  return {
    band,
    totalValueKRW: r.totalRealizedKRW + r.endingHoldingValueKRW,
    realizedKRW: r.totalRealizedKRW,
    endingValueKRW: r.endingHoldingValueKRW,
    endingHoldingFx: r.endingHoldingFx,
    weightedAverageRate: r.weightedAverageRate,
    ratePremium: r.ratePremium,
    tradeCount: r.tradeCount,
    tradesPerYear: years > 0 ? r.tradeCount / years : r.tradeCount,
    heldByBandChecks: r.heldByBandChecks,
    cappedByLossTrades: r.cappedByLossTrades,
    maxExposureKRW: r.maxExposureKRW,
  }
}

/**
 * 한 기간을 기준별로 돌린다. 워밍업 표본이 부족해 결과가 없으면 null.
 * onRun 은 진행률 표시용(백테스트 1회마다 호출).
 */
export function reviewPeriod(
  input: BandReviewInput, def: ReviewPeriodDef, onRun?: () => void,
): BandReviewPeriod | null {
  const series: RegimeSeriesPoint[] = input.base.series
  if (!series.length) return null
  const endDate = series[series.length - 1].date
  const startDate = monthsBefore(endDate, def.months)
  if (series[0].date > startDate) return null

  const results = REVIEW_BANDS.map(band => {
    const r = runBacktest({ ...input.base, startDate, protocol: { ...input.protocol, rebalanceBandPct: band } })
    onRun?.()
    return { band, r }
  })
  if (results.some(x => x.r.points.length === 0)) return null

  const years = def.months / 12
  const raw = results.map(x => rowFrom(x.band, x.r, years))
  const best = raw.reduce((a, b) => (b.totalValueKRW > a.totalValueKRW ? b : a))
  const sorted = [...raw].sort((a, b) => b.totalValueKRW - a.totalValueKRW)
  const rows: BandReviewRow[] = raw.map(r => ({
    ...r, rank: sorted.indexOf(r) + 1, gapToBestKRW: r.totalValueKRW - best.totalValueKRW,
  }))
  const cur = rows.find(r => Math.abs(r.band - input.protocol.rebalanceBandPct) < 1e-9)
    // 현행 기준이 1~5%p 목록에 없으면 따로 돌려 비교 행으로 넣는다
    ?? (() => {
      const r = runBacktest({ ...input.base, startDate, protocol: input.protocol })
      const row = rowFrom(input.protocol.rebalanceBandPct, r, years)
      return { ...row, rank: sorted.filter(s => s.totalValueKRW > row.totalValueKRW).length + 1,
               gapToBestKRW: row.totalValueKRW - best.totalValueKRW }
    })()

  const sales = (input.actualSales ?? []).filter(s => s.date >= startDate && s.date <= endDate)
  const amountFx = sales.reduce((t, s) => t + s.amountFx, 0)
  const actual = input.actualSales
    ? { count: sales.length, amountFx,
        weightedRate: amountFx > 0 ? sales.reduce((t, s) => t + s.amountFx * s.rate, 0) / amountFx : null }
    : null

  return {
    key: def.key, label: def.label, startDate, endDate, years,
    periodAverageRate: results[0].r.periodAverageRate,
    rows, bestBand: best.band, current: cur,
    currentNearBest: best.totalValueKRW <= 0
      ? true
      : (best.totalValueKRW - cur.totalValueKRW) / best.totalValueKRW <= NEAR_BEST_PCT,
    actual,
  }
}

/** 기간별 결과 → 결론 (판단 보조 — 의결은 회의가 한다) */
export function concludeBandReview(
  periods: BandReviewPeriod[], currentBand: number, currency: string, asOf: string,
): BandReviewReport {
  const winsByBand: Record<string, number> = {}
  for (const b of REVIEW_BANDS) winsByBand[bandKey(b)] = 0
  for (const p of periods) winsByBand[bandKey(p.bestBand)] = (winsByBand[bandKey(p.bestBand)] ?? 0) + 1

  const reasons: string[] = []
  let conclusion: BandReviewConclusion
  let suggestedBand: number | null = null

  if (periods.length < 2) {
    conclusion = 'insufficient'
    reasons.push(`비교 가능한 기간이 ${periods.length}개뿐입니다 — 환율 이력(ECOS 백필)을 늘린 뒤 다시 판단하세요.`)
  } else {
    const near = periods.filter(p => p.currentNearBest).length
    const half = Math.ceil(periods.length / 2)
    reasons.push(`현행 ${bandLabel(currentBand)}는 ${periods.length}개 기간 중 ${near}개에서 최선과 사실상 같았습니다(총가치 차이 ${(NEAR_BEST_PCT * 100).toFixed(2)}% 이내).`)
    if (near >= half) {
      conclusion = 'keep'
      reasons.push('과반 기간에서 최선 수준이므로 현행 유지 근거가 있습니다.')
    } else {
      conclusion = 'review'
      const top = Object.entries(winsByBand).sort((a, b) => b[1] - a[1])[0]
      suggestedBand = Number(top[0]) / 100
      reasons.push(`${bandLabel(suggestedBand)}가 ${top[1]}개 기간에서 1위였습니다 — 기준 변경을 검토할 만합니다.`)
    }
    const busy = periods.filter(p => p.current.tradesPerYear > BUSY_TRADES_PER_YEAR)
    if (busy.length) reasons.push(`현행 기준의 거래 빈도가 연 ${BUSY_TRADES_PER_YEAR}회를 넘는 기간이 있습니다(${busy.map(p => p.label).join(', ')}) — 실무 부담을 함께 고려하세요.`)
    const capped = periods.reduce((t, p) => t + p.current.cappedByLossTrades, 0)
    if (capped > 0) reasons.push(`분기 손실 한도 때문에 덜 판 거래가 ${capped}회 있었습니다 — 기준보다 한도가 결과를 좌우했을 수 있습니다.`)
  }

  return {
    currency, currentBand, asOf, periods, winsByBand, conclusion, suggestedBand, reasons,
    assumptions: '시작 재고·자금 규모·월 유입은 오늘 입력값을 과거에 놓은 가정입니다. 금액보다 기준 간 차이와 순위를 보십시오. '
      + '총가치 = 환전 실현액 + 기말 미환전 외화의 기말 환율 평가액. 실전 규칙(기준 미만 보류·분기 손실 한도)을 적용했습니다.',
  }
}

export function runBandReview(input: BandReviewInput, onRun?: (done: number, total: number) => void): BandReviewReport {
  const total = REVIEW_PERIODS.length * REVIEW_BANDS.length
  let done = 0
  const periods: BandReviewPeriod[] = []
  for (const def of REVIEW_PERIODS) {
    const before = done
    const p = reviewPeriod(input, def, () => { done++; onRun?.(done, total) })
    if (p) periods.push(p)
    // 이력 부족으로 건너뛴 기간도 진행률은 채운다
    else { done = before + REVIEW_BANDS.length; onRun?.(done, total) }
  }
  const asOf = input.base.series.at(-1)?.date ?? ''
  return concludeBandReview(periods, input.protocol.rebalanceBandPct, input.currency, asOf)
}

const won = (v: number) => `${Math.round(v / 1e6).toLocaleString()}백만원`

/** 의결사항 본문(policy_decisions.decision) — 회의 자료로 그대로 읽히게 */
export function bandReviewAgendaText(r: BandReviewReport): string {
  const head = r.conclusion === 'keep'
    ? `[판단 보조] 현행 ${bandLabel(r.currentBand)} 유지 근거 있음`
    : r.conclusion === 'review'
    ? `[판단 보조] ${bandLabel(r.suggestedBand ?? r.currentBand)} 로 변경 검토 제안`
    : '[판단 보조] 자료 부족 — 판단 보류'
  const lines: string[] = [
    `FX 리밸런싱 기준 회고 (${r.currency}, 기준일 ${r.asOf})`,
    head,
    ...r.reasons.map(x => `· ${x}`),
    '',
    '기간별 결과 (총가치 순위 · 평균 실현환율 · 연 거래 횟수):',
  ]
  for (const p of r.periods) {
    lines.push(`■ ${p.label} (${p.startDate}~${p.endDate}, 기간 평균 ${p.periodAverageRate.toFixed(1)}원)`)
    for (const row of p.rows) {
      const mark = Math.abs(row.band - r.currentBand) < 1e-9 ? ' ← 현행' : ''
      lines.push(`  ${bandLabel(row.band)}: ${row.rank}위 · ${row.weightedAverageRate == null ? '환전 없음' : `${row.weightedAverageRate.toFixed(1)}원`}`
        + ` · 연 ${row.tradesPerYear.toFixed(1)}회 · 최선 대비 ${row.gapToBestKRW === 0 ? '—' : won(row.gapToBestKRW)}${mark}`)
    }
    if (p.actual && p.actual.count > 0 && p.actual.weightedRate != null) {
      lines.push(`  회사 실제 매각: ${p.actual.count}건 · 평균 ${p.actual.weightedRate.toFixed(1)}원`)
    }
  }
  lines.push('', `※ ${r.assumptions}`, '※ 본 자료는 의사결정 참고용이며 기준 변경은 정책회의 의결로 정합니다.')
  return lines.join('\n')
}
