import { describe, it, expect } from 'vitest'
import { buildVerdict, STALE_LIMIT_BIZDAYS, type VerdictInput } from './fxVerdict'
import type { FxRegimeSignal } from './fxRegime'

/**
 * 2026-11-02 실사용 리포트 회귀 테스트.
 *
 * 같은 화면에서 조치 카드는 "오늘은 아무것도 하지 않습니다", 바로 아래 카드는
 * "정책 상한을 5.3억원 초과했습니다" 가 동시에 떴다. 리밸런싱 밴드(3%p)가
 * 정책 상한 초과를 묵인하고 있었기 때문이다.
 *
 * 원칙: **정책 상한 복귀는 의무, 리짐 권고는 재량. 충돌하면 의무가 이긴다.**
 */
const RATE = 1332.79

function signalOf(p: { current: number; target: number; actionRequired: boolean; tradeKRW: number; asOf?: string }): FxRegimeSignal {
  return {
    asOf: p.asOf ?? '2026-10-30',
    currency: 'USD',
    indicators: { close: RATE } as FxRegimeSignal['indicators'],
    regime: { code: '3-B', label: '횡보 / 저변동성', rawCode: '3-B', confirmedDays: 4 },
    level: null,
    decision: {
      rawTargetRatio: p.target, appliedTargetRatio: p.target, clampedBy: 'policy_band',
      bufferFloorRatio: 0, currentRatio: p.current,
      suggestedTradeKRW: p.tradeKRW, actionRequired: p.actionRequired,
      action: '', expectedRealizedPnlKRW: null, belowCost: false,
    },
  } as FxRegimeSignal
}

function input(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    signal: signalOf({ current: 0.3059, target: 0.30, actionRequired: false, tradeKRW: -527_000_000 }),
    currency: 'USD', holdingFx: 15_613_905, avgCostRate: 0,
    allowedFx: 0, requestedFx: 0, pctDaysAboveBep: null,
    bandExcessKRW: 0, bandMaxPct: 30, asOfStaleDays: 0,
    ...over,
  }
}

describe('정책 상한 초과는 리밸런싱 밴드로 묵인되지 않는다', () => {
  it('[회귀] 조치 불필요 + 상한 초과 → "아무것도 하지 않습니다" 가 아니라 매도', () => {
    const v = buildVerdict(input({ bandExcessKRW: 400_000_000 }))
    expect(v.kind).toBe('sell')
    expect(v.tone).toBe('act')
    expect(v.headline).toContain('정책 상한')
    expect(v.headline).not.toContain('아무것도')
    // 약 300,123 USD = 4.0억 ÷ 1,332.79
    expect(v.order).toMatch(/USD 300,1\d\d/)
    expect(v.order).toContain('4.0억원')
  })

  it('상한 이내면 종전대로 조치 없음', () => {
    const v = buildVerdict(input({ bandExcessKRW: 0 }))
    expect(v.kind).toBe('hold')
    expect(v.headline).toBe('오늘은 아무것도 하지 않습니다.')
  })

  it('환전을 미루는 구간이어도 상한을 넘었으면 복귀분은 집행한다', () => {
    const v = buildVerdict(input({
      signal: signalOf({ current: 0.3059, target: 0.34, actionRequired: true, tradeKRW: +300_000_000 }),
      bandExcessKRW: 120_000_000,
    }))
    expect(v.kind).toBe('sell')
    expect(v.headline).toContain('복귀분은 집행')
  })
})

describe('리짐 권고와 상한 복귀분 중 큰 쪽을 따른다', () => {
  const sellSignal = signalOf({ current: 0.3059, target: 0.263, actionRequired: true, tradeKRW: -3_830_000_000 })

  it('리짐 권고가 더 크면 그대로 — 상한도 자동 충족된다 (EUR 실사례)', () => {
    const v = buildVerdict(input({
      signal: sellSignal, currency: 'EUR',
      allowedFx: 614_384, requestedFx: 2_572_523,     // 손실 한도로 일부만
      bandExcessKRW: 120_000_000,                      // 1.2억 < 8.3억
    }))
    expect(v.kind).toBe('sell_partial')
    expect(v.order).toContain('EUR 614,384')
    expect(v.headline).toContain('분기 손실 한도')
  })

  it('[회귀] 상한 복귀분이 더 크면 그 금액으로 올린다', () => {
    const v = buildVerdict(input({
      signal: sellSignal,
      allowedFx: 10_000, requestedFx: 10_000,          // 리짐 집행 약 0.13억
      bandExcessKRW: 400_000_000,                      // 4.0억 ≫ 0.13억
    }))
    expect(v.kind).toBe('sell')
    expect(v.headline).toContain('정책 상한을 넘었습니다')
    expect(v.order).toMatch(/USD 300,1\d\d/)
  })

  it('손실 한도 때문에 상한 복귀가 모자라면 부족분을 밝힌다', () => {
    const v = buildVerdict(input({
      signal: sellSignal,
      allowedFx: 100_000, requestedFx: 2_000_000,
      bandExcessKRW: 400_000_000,                      // 복귀에 300,123 필요, 한도는 100,000
    }))
    expect(v.caveat).toContain('부족')
    expect(v.caveat).toContain('회의체')
  })
})

describe('환율 이력이 끊긴 통화 — 판정을 단정하지 않는다', () => {
  const stale = { signal: signalOf({ current: 0.3059, target: 0.297, actionRequired: true, tradeKRW: -830_000_000, asOf: '2022-12-30' }) }

  it('[회귀] 4년 전 데이터로 "실행 필요" 를 단정하지 않는다', () => {
    const v = buildVerdict(input({ ...stale, asOfStaleDays: 980, bandExcessKRW: 0 }))
    expect(v.kind).toBe('blocked')
    expect(v.tone).toBe('warn')
    expect(v.reasons.join(' ')).toContain('2022-12-30')
  })

  it('판정은 보류해도 상한 복귀 의무는 유효하다', () => {
    const v = buildVerdict(input({ ...stale, asOfStaleDays: 980, bandExcessKRW: 120_000_000, currency: 'EUR' }))
    expect(v.kind).toBe('sell')
    expect(v.headline).toContain('보류')
    expect(v.order).toContain('1.2억원')
  })

  it('허용 범위 안이면 정상 판정한다', () => {
    const v = buildVerdict(input({ asOfStaleDays: STALE_LIMIT_BIZDAYS }))
    expect(v.kind).toBe('hold')
  })
})

describe('orderKRW — 화면이 안분할 바구니 총액', () => {
  it('매도 권고는 집행 원화액을 돌려준다', () => {
    const v = buildVerdict(input({
      signal: signalOf({ current: 0.307, target: 0.267, actionRequired: true, tradeKRW: -3_590_000_000 }),
      allowedFx: 2_676_655, requestedFx: 2_676_655,
    }))
    expect(v.orderKRW).toBeCloseTo(2_676_655 * RATE, 0)
  })

  it('조치 없음이면 null — 배분표를 그리지 않는다', () => {
    expect(buildVerdict(input()).orderKRW).toBeNull()
  })

  it('상한 복귀만 집행하는 경우 그 금액을 돌려준다', () => {
    expect(buildVerdict(input({ bandExcessKRW: 470_000_000 })).orderKRW).toBe(470_000_000)
  })
})
