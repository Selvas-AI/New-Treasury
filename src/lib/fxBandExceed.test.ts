import { describe, it, expect } from 'vitest'
import { allocateAcrossBasket } from './fxBandExceed'

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
