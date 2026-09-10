import { describe, it, expect } from 'vitest'
import { computeFxEffect, amountsOf, isMaterial, type FxCurrencyEffect } from './fxEffect'

describe('computeFxEffect — 3분해', () => {
  it('환율이 그대로면 전부 거래효과다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000 },
      closeAmounts: { USD: 1_500_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1400 },
      observedKrwDelta: 700_000_000,
    })
    expect(r.tradeEffect).toBe(700_000_000)
    expect(r.fxEffect).toBe(0)
    expect(r.crossEffect).toBe(0)
    expect(r.residual).toBe(0)
  })

  it('잔액이 그대로면 전부 환율효과다 — 현금은 움직이지 않았다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000 },
      closeAmounts: { USD: 1_000_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1450 },
      observedKrwDelta: 50_000_000,
    })
    expect(r.tradeEffect).toBe(0)
    expect(r.fxEffect).toBe(50_000_000)
    expect(r.crossEffect).toBe(0)
  })

  it('둘 다 움직이면 교차항이 생긴다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000 },
      closeAmounts: { USD: 1_200_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1450 },
      observedKrwDelta: 340_000_000,
    })
    expect(r.tradeEffect).toBe(200_000 * 1400)   // 280,000,000
    expect(r.fxEffect).toBe(1_000_000 * 50)      //  50,000,000
    expect(r.crossEffect).toBe(200_000 * 50)     //  10,000,000
    // 세 항의 합 = 기말환산 − 기초환산
    expect(r.tradeEffect + r.fxEffect + r.crossEffect).toBe(1_200_000 * 1450 - 1_000_000 * 1400)
  })

  // ⭐ 총액의 정본은 저장된 fx_krw 다. ECOS 환율로 다시 계산하면 화면마다 값이 갈라진다.
  //   그 차이를 0 으로 보정하지 않고 잔차로 드러내는 것이 이 모듈의 핵심 계약이다.
  it('입력환율과 ECOS 환율이 다르면 그 차이를 잔차로 남긴다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000 },
      closeAmounts: { USD: 1_000_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1450 },
      observedKrwDelta: 52_000_000,        // 실제 저장값은 5,200만
    })
    expect(r.fxEffect).toBe(50_000_000)
    expect(r.residual).toBe(2_000_000)     // 200만은 환율 출처 차이
  })

  // CNY 는 분해 대상에서 제외했다(ECOS 통화코드 미등록 + 잔액 미미).
  // 그 몫은 조용히 사라지지 않고 residual 로 남는다.
  it('CNY 는 분해 대상이 아니며 그 몫은 잔차로 남는다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000, CNY: 500_000 },
      closeAmounts: { USD: 1_000_000, CNY: 700_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1450 },
      observedKrwDelta: 90_000_000,
    })
    expect(r.currencies.some(c => c.currency === 'CNY')).toBe(false)
    expect(r.missingCurrencies).toEqual([])      // CNY 를 '이력 없음'으로 경고하지 않는다
    expect(r.fxEffect).toBe(50_000_000)          // USD 만 분해됨
    expect(r.residual).toBe(40_000_000)          // CNY 몫은 잔차로
  })

  it('분해 대상 통화의 환율 이력이 비면 명시한다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000, GBP: 100_000 },
      closeAmounts: { USD: 1_000_000, GBP: 100_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1450 },
      observedKrwDelta: 50_000_000,
    })
    expect(r.missingCurrencies).toEqual(['GBP'])
  })

  it('잔액이 양쪽 다 0 인 통화는 환율이 없어도 경고하지 않는다', () => {
    const r = computeFxEffect({
      from: '2026-01-01', to: '2026-01-31',
      openAmounts:  { USD: 1_000_000 },
      closeAmounts: { USD: 1_000_000 },
      openRates:  { USD: 1400 },
      closeRates: { USD: 1400 },
      observedKrwDelta: 0,
    })
    expect(r.missingCurrencies).toEqual([])
  })
})

describe('amountsOf', () => {
  it('null 필드를 0 으로 채운다', () => {
    expect(amountsOf({ fx_usd: 100, fx_eur: null })).toEqual({
      USD: 100, EUR: 0, JPY: 0, GBP: 0, CNY: 0,
    })
  })
  it('레코드가 없으면 빈 객체', () => {
    expect(amountsOf(null)).toEqual({})
  })
})

describe('isMaterial — 1천만원 미만 무시', () => {
  const base: FxCurrencyEffect = {
    currency: 'USD', openAmount: 0, closeAmount: 0, amountDelta: 0,
    openRate: 1400, closeRate: 1400, rateDelta: 0,
    openKrw: 0, closeKrw: 0,
    tradeEffect: 0, fxEffect: 0, crossEffect: 0, totalEffect: 0, missingRate: false,
  }
  it('1천만원 이상만 표시한다', () => {
    expect(isMaterial({ ...base, totalEffect: 9_999_999 })).toBe(false)
    expect(isMaterial({ ...base, totalEffect: -10_000_000 })).toBe(true)
  })
  it('분해 못 했어도 잔액이 있으면 표시한다 — 환율 이력 없음을 알려야 한다', () => {
    expect(isMaterial({
      ...base, totalEffect: null, missingRate: true, closeAmount: 500_000,
    })).toBe(true)
  })
})
