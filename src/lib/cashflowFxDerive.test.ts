import { describe, it, expect } from 'vitest'
import { deriveRegimeOpsFromPlan, addWeeks, type PlanItemLike } from './cashflowFxDerive'

const W0 = '2026-08-10'   // 기준 주 월요일
const w = (n: number) => addWeeks(W0, n)

const items: PlanItemLike[] = [
  // USD 유입 — 12주 안에 300만 × 3회
  { week_start: w(0),  direction: 'in',  amount: 1_000_000, currency: 'USD' },
  { week_start: w(4),  direction: 'in',  amount: 1_000_000, currency: 'USD' },
  { week_start: w(8),  direction: 'in',  amount: 1_000_000, currency: 'USD' },
  // USD 유출 — 13주 안 2건 + 13주 밖 1건(버퍼 제외 대상)
  { week_start: w(1),  direction: 'out', amount: 1_500_000, currency: 'USD' },
  { week_start: w(12), direction: 'out', amount:   500_000, currency: 'USD' },
  { week_start: w(20), direction: 'out', amount: 9_000_000, currency: 'USD' },
  // 과거 주 — 제외
  { week_start: addWeeks(W0, -2), direction: 'in', amount: 7_000_000, currency: 'USD' },
  // 원화 — 제외
  { week_start: w(0),  direction: 'in',  amount: 5_000_000_000, currency: 'KRW' },
  // 통화 미지정(레거시 행) — KRW 로 간주해 제외
  { week_start: w(0),  direction: 'in',  amount: 1_234_000 },
  // EUR
  { week_start: w(2),  direction: 'out', amount:   300_000, currency: 'EUR' },
]

describe('deriveRegimeOpsFromPlan', () => {
  const out = deriveRegimeOpsFromPlan(items, W0, ['USD', 'EUR', 'JPY'])
  const usd = out.find(o => o.currency === 'USD')!
  const eur = out.find(o => o.currency === 'EUR')!
  const jpy = out.find(o => o.currency === 'JPY')!

  it('월 유입 = 향후 유입 합계 ÷ 3개월', () => {
    expect(usd.monthlyInflowFx).toBe(1_000_000)   // 300만 ÷ 3
  })

  it('결제 버퍼 = 향후 13주 이내 유출만 합산', () => {
    // w(1) 150만 + w(12) 50만 = 200만. w(20) 900만은 13주 밖이라 제외.
    expect(usd.fxPayableFx).toBe(2_000_000)
  })

  it('기준 주 이전 계획은 세지 않는다', () => {
    // 과거 700만이 들어갔다면 월 유입이 333만이 됐을 것
    expect(usd.monthlyInflowFx).not.toBe(3_333_333.33)
  })

  it('원화·통화 미지정 행은 외화 산출에서 제외한다', () => {
    // KRW 50억과 미지정 123.4만이 섞였다면 USD 값이 오염됐을 것
    expect(usd.monthlyInflowFx).toBe(1_000_000)
  })

  it('유출만 있는 통화도 산출한다', () => {
    expect(eur.monthlyInflowFx).toBe(0)
    expect(eur.fxPayableFx).toBe(300_000)
  })

  it('계획이 없는 통화는 0 + itemCount 0 으로 구분 가능하다', () => {
    expect(jpy.monthlyInflowFx).toBe(0)
    expect(jpy.fxPayableFx).toBe(0)
    expect(jpy.itemCount).toBe(0)
  })
})
