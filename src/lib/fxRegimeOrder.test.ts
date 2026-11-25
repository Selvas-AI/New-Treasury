import { describe, it, expect } from 'vitest'
import { buildRegimeOrderPayloads } from './fxRegimeOrder'
import { allocateAcrossBasket } from './fxBandExceed'
import { addBizDays } from './bizDay'

const BASKET = {
  USD: { nativeAmount: 16_000_000, krwAmount: 22_400_000_000 },   // 1,400
  EUR: { nativeAmount: 3_400_000,  krwAmount: 5_100_000_000 },    // 1,500
  JPY: { nativeAmount: 5_000_000,  krwAmount: 47_500_000 },       // 9.5
}
const SUMMARY = { leadCode: 'USD', regimeCode: '4-B', levelLabel: '높음',
  targetRatio: 0.25, currentRatio: 0.294, asOf: '2026-11-24' }

function build(totalKRW: number, info = {}) {
  return buildRegimeOrderPayloads({
    company: '메디아나', allocation: allocateAcrossBasket(totalKRW, BASKET), info,
    summary: SUMMARY, createdBy: 'tester', today: '2026-11-25', groupId: 'abcd1234-ffff',
  })
}

describe('buildRegimeOrderPayloads — 바구니 권고를 배분표대로 통화별 지시로 (F-01)', () => {
  it('통화마다 한 건, 원화 합계 ≈ 바구니 총액', () => {
    const r = build(3_000_000_000)
    expect(r.payloads.map(p => p.currency).sort()).toEqual(['EUR', 'JPY', 'USD'])
    expect(Math.abs(r.totalKRW - 3_000_000_000)).toBeLessThan(5_000)   // 내림 오차만
    expect(r.shortfalls).toEqual([])
  })

  it('지시 통화와 수량·환율이 서로 맞다 — 현재 탭 통화로 대표 통화 수량을 넣지 않는다', () => {
    const r = build(3_000_000_000)
    const eur = r.payloads.find(p => p.currency === 'EUR')!
    expect(eur.trade_rate).toBeCloseTo(1500, 6)
    expect(eur.amount_krw).toBe(Math.round(eur.amount_fx * 1500))
  })

  it('JPY 는 원/1엔 환율·0자리 수량', () => {
    const jpy = build(3_000_000_000).payloads.find(p => p.currency === 'JPY')!
    expect(jpy.trade_rate).toBeCloseTo(9.5, 6)
    expect(Number.isInteger(jpy.amount_fx)).toBe(true)
  })

  it('환전 가능 재고가 몫보다 적으면 재고만큼만 등록하고 부족분을 밝힌다(다른 통화로 넘기지 않음)', () => {
    const r = build(3_000_000_000, { USD: { bookRate: 1450, availableFx: 1_000_000 } })
    const usd = r.payloads.find(p => p.currency === 'USD')!
    expect(usd.amount_fx).toBe(1_000_000)
    expect(r.shortfalls.map(s => s.code)).toEqual(['USD'])
    // EUR 몫은 그대로 — 부족분을 재배분하지 않는다
    const eurShare = allocateAcrossBasket(3_000_000_000, BASKET).find(a => a.code === 'EUR')!
    expect(r.payloads.find(p => p.currency === 'EUR')!.amount_fx).toBeCloseTo(Math.floor(eurShare.nativeAmount! * 100) / 100, 2)
  })

  it('장부환율이 있으면 예상 손익을 남기고, 없으면 null', () => {
    const r = build(3_000_000_000, { USD: { bookRate: 1450, availableFx: null } })
    const usd = r.payloads.find(p => p.currency === 'USD')!
    expect(usd.fx_pnl).toBe(Math.round((1400 - 1450) * usd.amount_fx))
    expect(r.payloads.find(p => p.currency === 'EUR')!.fx_pnl).toBeNull()
  })

  it('리짐 지시 규약 — order_type=regime, 기한 +3영업일, 같은 권고 묶음 ID', () => {
    const r = build(3_000_000_000)
    for (const p of r.payloads) {
      expect(p.order_type).toBe('regime')
      expect(p.due_date).toBe(addBizDays('2026-11-25', 3))
      expect(p.memo).toContain('[basket:abcd1234]')
    }
  })
})
