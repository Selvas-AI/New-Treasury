import { describe, it, expect } from 'vitest'
import { allocateAcrossBasket, computeFxBandExceed } from './fxBandExceed'

/**
 * 2026-11-04 리포트 회귀 — 조치 카드가 "선택한 통화 하나로 전량 판다"는 금액을 보여줘
 * 탭마다 금액이 달랐고, 사용자가 USD 금액과 EUR 금액을 더해야 하나 고민했다.
 * 상한 초과 카드와 **같은 안분 규칙**을 쓰게 해 한 화면에서 말이 맞게 한다.
 */
const BASKET = {
  USD: { nativeAmount: 15_613_905.53, krwAmount: 20_980_000_000 },
  EUR: { nativeAmount:  4_322_781.37, krwAmount:  6_500_000_000 },
  JPY: { nativeAmount: 12_720_567,    krwAmount:    110_000_000 },
}

describe('allocateAcrossBasket', () => {
  it('보유 구성비대로 나누고 합계가 보존된다', () => {
    const rows = allocateAcrossBasket(3_590_000_000, BASKET)
    expect(rows.map(r => r.code)).toEqual(['USD', 'EUR', 'JPY'])   // 금액 내림차순
    expect(rows.reduce((s, r) => s + r.krwAmount, 0)).toBeCloseTo(3_590_000_000, 0)
    expect(rows[0].sharePct).toBeCloseTo(76.0, 1)
    expect(rows[1].sharePct).toBeCloseTo(23.6, 1)
  })

  it('외화 수량은 그 통화의 적용 환율로 환산한다 — 별도 환율 주입이 필요 없다', () => {
    const rows = allocateAcrossBasket(3_590_000_000, BASKET)
    const usd = rows.find(r => r.code === 'USD')!
    const rate = BASKET.USD.krwAmount / BASKET.USD.nativeAmount
    expect(usd.nativeAmount).toBeCloseTo(usd.krwAmount / rate, 2)
  })

  it('보유가 없거나 금액이 0이면 빈 배열', () => {
    expect(allocateAcrossBasket(0, BASKET)).toEqual([])
    expect(allocateAcrossBasket(1e8, {})).toEqual([])
  })

  it('보유가 0인 통화는 배분에서 제외한다', () => {
    const rows = allocateAcrossBasket(1e8, { ...BASKET, GBP: { nativeAmount: 0, krwAmount: 0 } })
    expect(rows.find(r => r.code === 'GBP')).toBeUndefined()
  })
})

// ── 준수 기준은 밴드 '상한'이다 (2026-11-25 실사고 회귀 방지) ──────────
//
// 자금정책 ④ 매각 집행 탭이 밴드 하한(25%)을 상한 자리에 써서
// "41.0억 초과" 라고 경고하는 동안, 리짐 화면은 상한(30%)으로 "밴드 이내" 라고 했다.
// 같은 밴드를 두 화면이 정반대로 말한 사고다.
describe('computeFxBandExceed — 상한/하한 혼동 방지', () => {
  // 실사례 수치: 가용 자금 923.4억 · 보유 271.9억 · 밴드 25~30%
  const DATA = {
    fxRatio: 29.4,
    fxPortfolioHoldings: 27_190_000_000,
    fxPolicyDenominator: 92_340_000_000,
    fxByCurrency: {
      USD: { nativeAmount: 16_478_506, krwAmount: 22_130_000_000 },
      EUR: { nativeAmount: 3_403_818,  krwAmount: 5_010_000_000 },
      JPY: { nativeAmount: 5_391_191,  krwAmount: 45_450_000 },
    },
  }
  const params = (min: number | null, max: number | null) => ({
    get: (k: string) => (k === 'fx_target_min' ? min : k === 'fx_target_max' ? max : null),
  })

  it('상한(30%)으로 판정하면 밴드 이내 — 초과 0', () => {
    const r = computeFxBandExceed(DATA, params(25, 30))
    expect(r.ceilingKRW).toBeCloseTo(27_702_000_000, -6)   // 923.4억 × 30%
    expect(r.over).toBe(false)
    expect(r.excessKRW).toBe(0)
  })

  it('하한(25%)을 상한 자리에 쓰면 41억이 초과로 잡힌다 — 사고 당시 수치 재현', () => {
    const wrong = computeFxBandExceed(DATA, params(25, 25))
    expect(wrong.ceilingKRW).toBeCloseTo(23_085_000_000, -6) // 923.4억 × 25%
    expect(wrong.excessKRW / 1e8).toBeCloseTo(41.0, 0)       // 41.0억
  })

  it('상한 미설정이면 configured=false — 조용히 한도 내로 보이면 안 된다', () => {
    const r = computeFxBandExceed(DATA, params(25, null))
    expect(r.configured).toBe(false)
    expect(r.over).toBe(false)
  })
})
