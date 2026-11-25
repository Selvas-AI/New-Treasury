import { describe, it, expect } from 'vitest'
import { buildBasketDecision, pickLeadCurrency, type BasketDecisionInput } from './fxBasketDecision'
import { computeFxBandExceed } from './fxBandExceed'
import { normalizedRate } from '../hooks/useFxHistory'

// 30영업일 이상의 완만한 시계열 (판정이 나오도록)
function series(base: number, days = 300, drift = 0) {
  const out: { date: string; rate: number }[] = []
  const d = new Date('2025-01-02T00:00:00Z')
  for (let i = 0; i < days; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    out.push({ date: d.toISOString().slice(0, 10), rate: base * (1 + drift * i) + Math.sin(i / 3) * base * 0.002 })
  }
  return out
}

const BASKET = {
  USD: { nativeAmount: 16_000_000, krwAmount: 22_400_000_000 },   // 1,400
  EUR: { nativeAmount: 3_400_000,  krwAmount: 5_100_000_000 },    // 1,500
  JPY: { nativeAmount: 5_000_000,  krwAmount: 47_500_000 },       // 9.5
}

function input(over: Partial<BasketDecisionInput> = {}): BasketDecisionInput {
  const params: Record<string, number> = { fx_target_min: 25, fx_target_max: 30 }
  const get = (k: string) => params[k] ?? null
  const policyLike = {
    fxRatio: 29.4, fxPortfolioHoldings: 27_547_500_000, fxPolicyDenominator: 93_000_000_000,
    fxByCurrency: BASKET,
  }
  return {
    basket: BASKET,
    denominatorKRW: policyLike.fxPolicyDenominator,
    holdingsKRW: policyLike.fxPortfolioHoldings,
    get,
    currencies: {
      USD: { series: series(1400), lots: null, payableFx: 2_500_000 },
      EUR: { series: series(1500), lots: null, payableFx: 500_000 },
      JPY: { series: series(9.5), lots: null, payableFx: 0 },
      GBP: { series: [], lots: null, payableFx: 0 },
    },
    marketRates: { USD: 1400, EUR: 1500, JPY: 9.5 },
    bandExceed: computeFxBandExceed(policyLike, { get }),
    quarterLossCapKRW: 0,
    realizedLossKRW: 0,
    prevLead: null,
    today: '2025-12-31',
    ...over,
  }
}

describe('pickLeadCurrency — 대표 통화와 전환 히스테리시스 (F-20)', () => {
  it('원화 환산 보유 1위가 대표', () => {
    expect(pickLeadCurrency(BASKET, null).code).toBe('USD')
  })
  it('직전 대표와 1위의 차이가 5%p 미만이면 직전 대표를 유지한다', () => {
    const close = { USD: { nativeAmount: 1, krwAmount: 51 }, EUR: { nativeAmount: 1, krwAmount: 49 } }
    expect(pickLeadCurrency(close, 'EUR').code).toBe('EUR')     // 51% vs 49% — 바꾸지 않음
    expect(pickLeadCurrency(close, null).code).toBe('USD')
  })
  it('차이가 5%p 이상이면 1위로 바꾼다', () => {
    const far = { USD: { nativeAmount: 1, krwAmount: 60 }, EUR: { nativeAmount: 1, krwAmount: 40 } }
    expect(pickLeadCurrency(far, 'EUR').code).toBe('USD')
  })
  it('직전 대표의 보유가 0이면 유지하지 않는다', () => {
    expect(pickLeadCurrency(BASKET, 'GBP').code).toBe('USD')
  })
})

describe('buildBasketDecision — 바구니 ctx (F-06)', () => {
  it('결제 버퍼는 **모든 통화의 합계**다 (현재 탭 통화 하나가 아니다)', () => {
    const r = buildBasketDecision(input())
    // USD 2.5M × 1400 + EUR 0.5M × 1500 = 35억 + 7.5억
    expect(r.ctx.fxPayableKRW).toBeCloseTo(2_500_000 * series(1400).at(-1)!.rate + 500_000 * series(1500).at(-1)!.rate, -3)
  })

  it('JPY 버퍼는 정규화된 원/1엔으로 환산한다 — 원/100엔이면 100배가 된다(F-02)', () => {
    const r = buildBasketDecision(input({
      currencies: {
        USD: { series: series(1400), lots: null, payableFx: 0 },
        JPY: { series: series(9.5), lots: null, payableFx: 1_000_000 },
      },
    }))
    expect(r.ctx.fxPayableKRW).toBeLessThan(10_000_000)   // 약 950만원(100배면 9.5억)
  })

  it('판정은 대표 통화 시계열로 한다', () => {
    const r = buildBasketDecision(input())
    expect(r.leadCode).toBe('USD')
    expect(r.signal?.currency).toBe('USD')
  })

  it('입력이 같으면 결과가 같다 — "현재 탭"이 입력에 없으므로 탭과 무관하다', () => {
    const a = buildBasketDecision(input())
    const b = buildBasketDecision(input())
    expect(a.verdict?.kind).toBe(b.verdict?.kind)
    expect(a.signal?.decision.appliedTargetRatio).toBe(b.signal?.decision.appliedTargetRatio)
  })

  it('판정 이력이 오래되면(blocked) 리짐 몫은 0 — 오래된 데이터로 지시를 만들지 않는다', () => {
    const r = buildBasketDecision(input({ today: '2026-11-25' }))   // 시계열은 2025 년에 끝남
    expect(r.staleDays).toBeGreaterThan(10)
    expect(r.regimeExecKRW).toBe(0)
    expect(r.regimeSuggestKRW).toBe(0)
  })

  it('대표 통화 시계열이 부족하면 판정이 없다', () => {
    const r = buildBasketDecision(input({
      currencies: { USD: { series: series(1400, 10), lots: null, payableFx: 0 } },
    }))
    expect(r.signal).toBeNull()
    expect(r.verdict).toBeNull()
  })
})

describe('normalizedRate — JPY 단위 정규화 (F-02)', () => {
  it('원/100엔 고시값을 원/1엔으로', () => {
    expect(normalizedRate({ date: '2026-11-24', rate: 950, unitBasis: 100 })).toBe(9.5)
  })
  it('단위가 1이면 그대로', () => {
    expect(normalizedRate({ date: '2026-11-24', rate: 1400, unitBasis: 1 })).toBe(1400)
  })
})
