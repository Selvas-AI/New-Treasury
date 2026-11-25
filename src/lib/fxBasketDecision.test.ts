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
    // 시계열 마지막 날 — 이보다 늦으면 '판정 이력 오래됨(blocked)'으로 리짐 몫이 0 이 된다
    today: series(1400).at(-1)!.date,
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

// ── 예산 — 통화별 재고·FIFO 손실 한도 (F-08 · F-15 · F-16) ─────────────────
import type { FxLot } from './fxLots'

const mkLot = (id: string, currency: string, amount: number, acqRate: number, acquired = '2025-01-01',
               accountType: FxLot['accountType'] = 'demand_deposit', maturity: string | null = null): FxLot => ({
  id, company: 'c', currency, acquiredDate: acquired, originalAmount: amount, remainingAmount: amount,
  acqRate, accountType, annualInterestRate: 0, maturityDate: maturity, sourceType: 'opening',
})

/** 리짐이 반드시 매도를 권고하도록 목표를 아주 낮게 둔 입력 */
function sellInput(over: Partial<BasketDecisionInput> = {}): BasketDecisionInput {
  const base = input(over)
  const params: Record<string, number> = { fx_target_min: 1, fx_target_max: 5 }
  return { ...base, get: k => params[k] ?? base.get(k), ...over }
}

describe('바구니 예산 — 통화별 재고 한도 (F-16)', () => {
  it('대표 통화 재고가 잠겨 있어도 다른 통화 몫은 그대로 집행 가능하다', () => {
    const usdLocked = [mkLot('u', 'USD', 16_000_000, 1300, '2025-01-01', 'term_deposit', '2099-01-01')]
    const eurFree   = [mkLot('e', 'EUR', 3_400_000, 1450)]
    const r = buildBasketDecision(sellInput({
      currencies: {
        USD: { series: series(1400), lots: { totalAmount: 16e6, availableAmount: 0, bookRate: 1300 }, payableFx: 0, fifoLots: usdLocked },
        EUR: { series: series(1500), lots: { totalAmount: 3.4e6, availableAmount: 3.4e6, bookRate: 1450 }, payableFx: 0, fifoLots: eurFree },
      },
    }))
    expect(r.budget).not.toBeNull()
    // USD 몫은 0, EUR 몫만 — 과거엔 대표(USD) 재고 0 으로 전체가 0 이 됐다
    expect(r.budget!.requestedKRW).toBeGreaterThan(0)
    const codes = r.regimeAllocation.map(a => a.code)
    expect(codes).not.toContain('USD')   // 잠긴 대표 통화 몫은 0
    expect(codes).toContain('EUR')       // 다른 통화 몫은 그대로 — 대표 재고로 전체를 자르지 않는다
  })
})

describe('바구니 예산 — 분기 손실 한도는 FIFO 실제 손실로 (F-08)', () => {
  it('오래된 고가 로트부터 나가 손실이 크면, 평균원가로 볼 때보다 적게만 집행한다', () => {
    // USD: 오래된 1,600원 로트 4M + 최근 1,200원 로트 12M → 평균 1,300원, 시장 1,400원
    //  평균원가로 보면 이익이지만 FIFO 는 1,600원부터 나가 손실이 난다
    const usd = [mkLot('old', 'USD', 4_000_000, 1600, '2024-01-01'), mkLot('new', 'USD', 12_000_000, 1200, '2025-06-01')]
    const params: Record<string, number> = { fx_target_min: 1, fx_target_max: 5, fx_ops_loss_cap: 100_000_000 }
    const r = buildBasketDecision(sellInput({
      get: k => params[k] ?? null,
      quarterLossCapKRW: 100_000_000,
      realizedLossKRW: 0,
      currencies: { USD: { series: series(1400), lots: { totalAmount: 16e6, availableAmount: 16e6, bookRate: 1300 }, payableFx: 0, fifoLots: usd } },
      basket: { USD: { nativeAmount: 16_000_000, krwAmount: 22_400_000_000 } },
      holdingsKRW: 22_400_000_000,
    }))
    expect(r.budget!.cappedByLoss).toBe(true)
    // 1,600원 로트를 팔면 1달러당 200원 손실 → 1억 한도면 50만 달러 안팎까지만
    expect(r.budget!.allowedKRW).toBeLessThan(1_000_000 * 1400)
    expect(r.budget!.allowedKRW).toBeGreaterThan(0)
  })

  it('한도 미설정이면 제약 없음', () => {
    const usd = [mkLot('old', 'USD', 16_000_000, 1600)]
    const r = buildBasketDecision(sellInput({
      currencies: { USD: { series: series(1400), lots: { totalAmount: 16e6, availableAmount: 16e6, bookRate: 1600 }, payableFx: 0, fifoLots: usd } },
      basket: { USD: { nativeAmount: 16_000_000, krwAmount: 22_400_000_000 } },
      holdingsKRW: 22_400_000_000,
    }))
    expect(r.budget!.cappedByLoss).toBe(false)
    expect(r.budget!.scale).toBe(1)
  })
})

describe('바구니 목표 = 통화별 목표의 보유 비중 가중평균 (D4)', () => {
  it('바구니 목표는 Σ 구성비 × 통화별 목표', () => {
    const r = buildBasketDecision(input())
    const weighted = r.currencyTargets.reduce((t, c) => t + (c.sharePct / 100) * c.targetRatio, 0)
    expect(r.signal!.decision.appliedTargetRatio).toBeCloseTo(weighted, 10)
    expect(r.currencyTargets.map(c => c.code)).toEqual(['USD', 'EUR', 'JPY'])
  })

  it('시계열이 부족한 통화는 대표 통화 목표를 대신 쓴다', () => {
    const r = buildBasketDecision(input({
      currencies: {
        USD: { series: series(1400), lots: null, payableFx: 0 },
        EUR: { series: series(1500, 10), lots: null, payableFx: 0 },
      },
    }))
    const eur = r.currencyTargets.find(c => c.code === 'EUR')!
    expect(eur.source).toBe('lead')
    expect(eur.targetRatio).toBe(r.leadTargetRatio)
  })

  it('통화별 매도 몫 합계 = 리짐 권고 총액, 자기 목표가 높은 통화는 덜 판다', () => {
    // EUR 만 강한 상승 추세 → EUR 목표가 USD 보다 높게 나오도록.
    // 정책 밴드에 눌리지 않게 밴드를 넓히고, 현재 비중을 높여(약 81%) 매도가 나오게 한다
    const wide: Record<string, number> = { fx_target_min: 1, fx_target_max: 95 }
    const r = buildBasketDecision(input({
      get: k => wide[k] ?? null,
      denominatorKRW: 34_000_000_000,
      currencies: {
        USD: { series: series(1400, 300, -0.0004), lots: null, payableFx: 0 },
        EUR: { series: series(1500, 300, 0.001), lots: null, payableFx: 0 },
        JPY: { series: series(9.5), lots: null, payableFx: 0 },
      },
    }))
    const sum = r.currencyTargets.reduce((t, c) => t + c.sellKRW, 0)
    expect(sum).toBeCloseTo(-r.signal!.decision.suggestedTradeKRW, -2)
    for (const c of r.currencyTargets) expect(c.sellKRW).toBeGreaterThanOrEqual(0)
    const usd = r.currencyTargets.find(c => c.code === 'USD')!
    const eur = r.currencyTargets.find(c => c.code === 'EUR')!
    expect(eur.targetRatio).toBeGreaterThan(usd.targetRatio)
    // 보유액 대비 매도 비율이 EUR 쪽이 더 낮다
    expect(eur.sellKRW / eur.holdingKRW).toBeLessThan(usd.sellKRW / usd.holdingKRW)
  })

  it('리짐 지시 배분(regimeAllocation)은 통화별 몫 비율을 따른다', () => {
    const r = buildBasketDecision(sellInput())
    expect(r.regimeExecKRW).toBeGreaterThan(0)
    const total = r.currencyTargets.reduce((t, c) => t + c.sellKRW, 0)
    for (const a of r.regimeAllocation) {
      const c = r.currencyTargets.find(x => x.code === a.code)!
      expect(a.krwAmount / r.regimeExecKRW).toBeCloseTo(c.sellKRW / total, 6)
    }
  })
})
