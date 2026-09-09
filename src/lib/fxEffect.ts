/**
 * 환율효과 분해 (2026-09-09, Phase 2)
 *
 * "USD 환산액이 3억 늘었다"만으로는 아무 판단도 할 수 없다. 달러를 더 보유하게 된 것인지,
 * 환율이 오른 것인지가 완전히 다른 이야기이기 때문이다. 그래서 세 겹으로 쪼갠다.
 *
 *   Δ(원화환산액)
 *     = 거래효과  Δ외화잔액 × 기초환율   — 실제로 외화가 늘거나 줄어서
 *     + 환율효과  기초 외화잔액 × Δ환율  — 가만히 있었는데 환율이 움직여서
 *     + 교차항    Δ외화잔액 × Δ환율      — 기중 증감분에 붙은 환율 변동
 *
 * ⭐ 총액은 절대 건드리지 않는다.
 *   운전자금 외화의 원화환산액 정본은 **daily.fx_krw**(입력 당일 환율로 계산돼 저장된 값)이다.
 *   자금 변동 이력·대시보드가 전부 이 값을 쓰므로, 여기서 ECOS 환율로 총액을 다시 계산하면
 *   화면마다 숫자가 갈라진다(세션19차 6.2% vs 27.9% 사고와 같은 유형).
 *   → ECOS 환율은 **그 총액 안에서 통화별 기여를 나누는 데에만** 쓴다.
 *
 * ⚠ 그래서 분해 합계와 실제 Δfx_krw 사이에 잔차가 남는다. 원인은 둘이다:
 *     · 입력 당시 적용한 환율과 ECOS 매매기준율의 차이
 *     · 환율 이력이 없는 통화(CNY 등)
 *   이 잔차를 0으로 보정하지 않고 `residual` 로 그대로 드러낸다.
 */

export type FxCode = 'USD' | 'EUR' | 'JPY' | 'GBP' | 'CNY'

export const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

/** 통화별 분해 결과 */
export interface FxCurrencyEffect {
  currency: FxCode
  /** 외화 잔액 (원통화) */
  openAmount: number
  closeAmount: number
  amountDelta: number
  /** 1외화당 원화 (정규화된 값). 이력이 없으면 null */
  openRate: number | null
  closeRate: number | null
  rateDelta: number | null
  /** 원화 환산 (ECOS 환율 기준) */
  openKrw: number | null
  closeKrw: number | null
  /** 3분해 — 환율 이력이 없으면 전부 null */
  tradeEffect: number | null   // 거래효과
  fxEffect:    number | null   // 환율효과
  crossEffect: number | null   // 교차항
  /** 이 통화의 환산액 변동 합계 (셋의 합) */
  totalEffect: number | null
  /** 환율 이력이 없어 분해하지 못한 통화인가 */
  missingRate: boolean
}

export interface FxEffectResult {
  from: string
  to: string
  currencies: FxCurrencyEffect[]
  /** 분해된 합계 */
  tradeEffect: number
  fxEffect: number
  crossEffect: number
  /** 저장된 fx_krw 로 관측된 실제 증감 (정본) */
  observedKrwDelta: number
  /**
   * 관측 − 분해합계. 입력환율과 ECOS 환율의 차이, 환율 이력이 없는 통화가 여기 모인다.
   * 0 으로 보정하지 않는다.
   */
  residual: number
  /** 환율 이력이 없어 분해에서 빠진 통화 */
  missingCurrencies: FxCode[]
}

/** 통화별 잔액 (daily 레코드의 fx_usd … fx_cny) */
export type FxAmounts = Partial<Record<FxCode, number>>

/** 통화별 1외화당 원화 (normalizedRate 로 정규화된 값) */
export type FxRates = Partial<Record<FxCode, number | null>>

export function computeFxEffect(params: {
  from: string
  to: string
  openAmounts: FxAmounts
  closeAmounts: FxAmounts
  openRates: FxRates
  closeRates: FxRates
  /** 저장된 fx_krw 기준 실제 증감 — 총액의 정본 */
  observedKrwDelta: number
}): FxEffectResult {
  const { from, to, openAmounts, closeAmounts, openRates, closeRates, observedKrwDelta } = params

  const currencies: FxCurrencyEffect[] = FX_CODES.map(code => {
    const openAmount  = openAmounts[code]  ?? 0
    const closeAmount = closeAmounts[code] ?? 0
    const amountDelta = closeAmount - openAmount
    const openRate  = openRates[code]  ?? null
    const closeRate = closeRates[code] ?? null

    // 잔액이 양쪽 다 0 이면 분해할 것이 없다 — 환율 유무와 무관하게 조용히 넘긴다.
    const idle = openAmount === 0 && closeAmount === 0
    const hasRates = openRate !== null && closeRate !== null

    if (idle || !hasRates) {
      return {
        currency: code, openAmount, closeAmount, amountDelta,
        openRate, closeRate,
        rateDelta: hasRates ? closeRate - openRate : null,
        openKrw:  hasRates ? openAmount  * openRate  : null,
        closeKrw: hasRates ? closeAmount * closeRate : null,
        tradeEffect: null, fxEffect: null, crossEffect: null, totalEffect: null,
        missingRate: !idle && !hasRates,
      }
    }

    const rateDelta   = closeRate - openRate
    const tradeEffect = amountDelta * openRate
    const fxEffect    = openAmount * rateDelta
    const crossEffect = amountDelta * rateDelta

    return {
      currency: code, openAmount, closeAmount, amountDelta,
      openRate, closeRate, rateDelta,
      openKrw:  openAmount  * openRate,
      closeKrw: closeAmount * closeRate,
      tradeEffect, fxEffect, crossEffect,
      totalEffect: tradeEffect + fxEffect + crossEffect,
      missingRate: false,
    }
  })

  const sum = (pick: (c: FxCurrencyEffect) => number | null) =>
    currencies.reduce((s, c) => s + (pick(c) ?? 0), 0)

  const tradeEffect = sum(c => c.tradeEffect)
  const fxEffect    = sum(c => c.fxEffect)
  const crossEffect = sum(c => c.crossEffect)

  return {
    from, to, currencies,
    tradeEffect, fxEffect, crossEffect,
    observedKrwDelta,
    residual: observedKrwDelta - (tradeEffect + fxEffect + crossEffect),
    missingCurrencies: currencies.filter(c => c.missingRate).map(c => c.currency),
  }
}

/** daily 레코드에서 통화별 잔액 추출 */
export function amountsOf(d: {
  fx_usd?: number | null; fx_eur?: number | null; fx_jpy?: number | null
  fx_gbp?: number | null; fx_cny?: number | null
} | null | undefined): FxAmounts {
  if (!d) return {}
  return {
    USD: d.fx_usd ?? 0, EUR: d.fx_eur ?? 0, JPY: d.fx_jpy ?? 0,
    GBP: d.fx_gbp ?? 0, CNY: d.fx_cny ?? 0,
  }
}

/**
 * 통화별 환율효과가 표시 대상인지 — 원화 환산 1천만원 미만은 무시한다
 * (2026-09-08 사용자 기준). 잔액이 미미한 통화까지 줄줄이 세우면 초점이 흐려진다.
 */
export const FX_EFFECT_THRESHOLD_KRW = 10_000_000

export function isMaterial(c: FxCurrencyEffect): boolean {
  const t = c.totalEffect
  if (t !== null && Math.abs(t) >= FX_EFFECT_THRESHOLD_KRW) return true
  // 분해는 못 했지만 잔액이 큰 통화는 "환율 이력 없음"을 알려야 하므로 남긴다
  return c.missingRate && Math.max(c.openAmount, c.closeAmount) > 0
}
