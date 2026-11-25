import { describe, it, expect } from 'vitest'
import {
  bandReviewAgendaText, concludeBandReview, runBandReview, REVIEW_BANDS,
  type BandReviewPeriod, type BandReviewRow,
} from './fxBandReview'
import { DEFAULT_PROTOCOL } from './fxRegime'

function series(days: number) {
  const out: { date: string; rate: number }[] = []
  const d = new Date('2023-01-02T00:00:00Z')
  for (let i = 0; i < days; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    out.push({ date: d.toISOString().slice(0, 10), rate: 1300 + 80 * Math.sin(i / 60) + 10 * Math.sin(i / 7) })
  }
  return out
}

const row = (band: number, total: number): BandReviewRow => ({
  band, totalValueKRW: total, realizedKRW: total, endingValueKRW: 0, endingHoldingFx: 0,
  weightedAverageRate: 1400, ratePremium: 0, tradeCount: 10, tradesPerYear: 10,
  heldByBandChecks: 0, cappedByLossTrades: 0, maxExposureKRW: 0, rank: 1, gapToBestKRW: 0,
})

function period(key: string, bestBand: number, currentNearBest: boolean): BandReviewPeriod {
  const rows = REVIEW_BANDS.map(b => row(b, b === bestBand ? 1e9 : 9e8))
  return {
    key, label: key, startDate: '2026-01-01', endDate: '2026-11-24', years: 1, periodAverageRate: 1400,
    rows, bestBand, current: rows[2], currentNearBest, actual: null,
  }
}

describe('concludeBandReview — 결론 규칙 (D5)', () => {
  it('과반 기간에서 현행이 최선 수준이면 유지', () => {
    const r = concludeBandReview([period('a', 0.03, true), period('b', 0.02, true), period('c', 0.05, false)], 0.03, 'USD', '2026-11-24')
    expect(r.conclusion).toBe('keep')
    expect(r.suggestedBand).toBeNull()
  })

  it('과반 기간에서 뒤지면 가장 자주 1위인 기준을 제안', () => {
    const r = concludeBandReview([period('a', 0.02, false), period('b', 0.02, false), period('c', 0.05, false)], 0.03, 'USD', '2026-11-24')
    expect(r.conclusion).toBe('review')
    expect(r.suggestedBand).toBe(0.02)
    expect(r.winsByBand['2']).toBe(2)
  })

  it('기간이 2개 미만이면 판단 보류', () => {
    expect(concludeBandReview([period('a', 0.03, true)], 0.03, 'USD', '2026-11-24').conclusion).toBe('insufficient')
  })

  it('안건 본문에 결론·기간·현행 표시가 들어간다', () => {
    const r = concludeBandReview([period('최근 1년', 0.03, true), period('최근 2년', 0.03, true)], 0.03, 'USD', '2026-11-24')
    const text = bandReviewAgendaText(r)
    expect(text).toContain('현행 3%p 유지 근거 있음')
    expect(text).toContain('■ 최근 1년')
    expect(text).toContain('← 현행')
  })
})

describe('runBandReview — 실제 백테스트 묶음', () => {
  it('이력이 충분하면 4개 기간 × 5개 기준을 돌리고, 진행률이 끝까지 찬다', () => {
    const progress: number[] = []
    const r = runBandReview({
      base: {
        series: series(1300), initialTotalKRW: 100_000_000_000, initialFxHolding: 20_000_000,
        monthlyInflowFx: 300_000, fxPayableFx: 0, policyMinRatio: null, policyMaxRatio: null, checkEveryDays: 20,
      },
      protocol: DEFAULT_PROTOCOL,
      currency: 'USD',
      actualSales: [{ date: '2026-06-01', amountFx: 100, rate: 1350 }],
    }, done => progress.push(done))
    expect(r.periods.map(p => p.key)).toEqual(['6m', '1y', '2y', '3y'])
    expect(progress.at(-1)).toBe(20)
    for (const p of r.periods) {
      expect(p.rows).toHaveLength(5)
      expect(p.rows.filter(x => x.rank === 1).length).toBeGreaterThanOrEqual(1)
      expect(Math.max(...p.rows.map(x => x.gapToBestKRW))).toBe(0)
    }
    expect(['keep', 'review']).toContain(r.conclusion)
  }, 60_000)

  it('이력이 짧으면 가능한 기간만 남는다', () => {
    const r = runBandReview({
      base: {
        series: series(300), initialTotalKRW: 1e11, initialFxHolding: 2e7,
        monthlyInflowFx: 3e5, fxPayableFx: 0, policyMinRatio: null, policyMaxRatio: null, checkEveryDays: 20,
      },
      protocol: DEFAULT_PROTOCOL, currency: 'USD',
    })
    expect(r.periods.map(p => p.key)).toEqual(['6m'])
    expect(r.conclusion).toBe('insufficient')
  })
})
