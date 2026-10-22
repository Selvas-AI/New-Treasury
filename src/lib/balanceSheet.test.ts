import { describe, it, expect } from 'vitest'
import { fundBalanceOf, crossCheckBalance, isBondRecord, isBondHeldOn } from './balanceSheet'
import type { InvestmentRecord } from '../types'

const toKRW = (amt: number, code: string) => amt * (code === 'USD' ? 1300 : 1)

function rec(p: Partial<InvestmentRecord>): InvestmentRecord {
  return {
    id: p.id ?? Math.random().toString(36), company: 'X', bank: 'A', product: '정기예금',
    currency: 'KRW', amount: 0, available: '가용', rate: 0, start: '2026-01-01',
    maturity: '', active: true, closed_date: null, acquisition_cost: 0, ...p,
  } as InvestmentRecord
}
/** 평가액 = bondQty × bondPrice ÷ 10 */
function bond(p: Partial<InvestmentRecord>): InvestmentRecord {
  return rec({ product: '국채', bank: '국고A', bondTicker: 'KR1', bondName: '국고A',
               bondQty: 1_000_000, bondPrice: 10_000, ...p })
}

describe('isBondRecord — 표기 변형에 걸리지 않는다', () => {
  it('공백이 섞여도 국채', () => expect(isBondRecord({ product: ' 국채 ' })).toBe(true))
  it('상품명이 달라도 채권 식별자가 있으면 국채',
    () => expect(isBondRecord({ product: '기타', bondTicker: 'KR1' })).toBe(true))
  it('일반 예금은 국채가 아니다', () => expect(isBondRecord({ product: '정기예금' })).toBe(false))
})

describe('isBondHeldOn — 국채에 만기 추정을 쓰지 않는다', () => {
  it('종료일이 있으면 그 날짜 기준', () => {
    expect(isBondHeldOn({ active: false, closed_date: '2026-10-10' }, '2026-10-01')).toBe(true)
    expect(isBondHeldOn({ active: false, closed_date: '2026-10-10' }, '2026-10-20')).toBe(false)
  })
  it('[회귀] 종료일이 없으면 active 를 믿는다 — 만기 2055년으로 되살아나면 안 된다', () => {
    expect(isBondHeldOn({ active: false, closed_date: null }, '2026-10-01')).toBe(false)
  })
})

describe('fundBalanceOf — 구성 합산', () => {
  const invests = [
    rec({ id: 'd1', amount: 100 }),                                   // 가용 예금
    rec({ id: 'd2', amount: 50, available: '불가용' }),                // 불가용 예금
    rec({ id: 'd3', amount: 2, currency: 'USD' }),                    // 외화 → 2,600
    bond({ id: 'b1', priceDate: '2026-10-20' }),                      // 국채 1,000,000,000
  ]
  it('가용·불가용·총액이 구성대로 나온다', () => {
    const b = fundBalanceOf({ investments: invests, operatingKrw: 1000, date: '2026-10-21', rule: 'active-now', toKRW })
    expect(b.investAvailKrw).toBe(100 + 2600)
    expect(b.investLockedKrw).toBe(50)
    expect(b.bondAvailKrw).toBe(1_000_000_000)
    expect(b.availableKrw).toBe(1000 + 2700 + 1_000_000_000)
    expect(b.totalKrw).toBe(b.availableKrw + b.lockedKrw)
  })

  it('[회귀] 국채 이력이 쌓여도 한 묶음으로만 센다', () => {
    const many = [
      ...Array.from({ length: 50 }, (_, i) =>
        bond({ id: `b${i}`, priceDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}` })),
      bond({ id: 'latest', priceDate: '2026-10-20', bondPrice: 7315 }),
    ]
    const b = fundBalanceOf({ investments: many, operatingKrw: 0, date: '2026-10-21', rule: 'active-now', toKRW })
    expect(b.bondGroupCount).toBe(1)
    expect(b.bondAvailKrw).toBe(1_000_000 * 7315 / 10)
  })

  it('[회귀] 티커를 잃은 복원 행이 섞여도 중복되지 않는다', () => {
    const mixed = [
      bond({ id: 'ok', priceDate: '2026-10-20', bondPrice: 7315 }),
      bond({ id: 'lost', priceDate: '2026-09-30', bondTicker: undefined, bondName: undefined }),
    ]
    expect(fundBalanceOf({ investments: mixed, operatingKrw: 0, date: '2026-10-21', rule: 'active-now', toKRW }).bondGroupCount).toBe(1)
  })

  it('기준일 이후 국채 행은 보지 않는다', () => {
    const b = fundBalanceOf({
      investments: [bond({ id: 'future', priceDate: '2026-12-01' })],
      operatingKrw: 0, date: '2026-10-21', rule: 'active-now', toKRW })
    expect(b.bondAvailKrw).toBe(0)
  })
})

describe('crossCheckBalance — 경로 간 불일치를 잡아낸다', () => {
  const base = [rec({ id: 'd1', amount: 1_000_000 }), bond({ id: 'b1', priceDate: '2026-10-20' })]

  it('같은 입력이면 일치', () => {
    const c = crossCheckBalance({
      restoredInvestments: base, currentInvestments: base,
      operatingKrw: 0, date: '2026-10-21', toKRW, compareActiveNow: true })
    expect(c.mismatch).toBe(false)
    expect(c.maxDiffKrw).toBe(0)
  })

  it('[회귀] 복원 경로에서 국채가 두 묶음이 되면 불일치로 잡힌다', () => {
    const broken = [...base, bond({ id: 'ghost', priceDate: '2026-09-30', bondTicker: undefined, bondName: undefined, bank: '다른은행' })]
    const c = crossCheckBalance({
      restoredInvestments: broken, currentInvestments: base,
      operatingKrw: 0, date: '2026-10-21', toKRW, compareActiveNow: true })
    expect(c.mismatch).toBe(true)
    expect(c.analysis.bondGroupCount).toBe(2)
    expect(c.activeNow?.bondGroupCount).toBe(1)
  })

  it('compareActiveNow=false 면 현재 보유 비교를 생략한다', () => {
    const c = crossCheckBalance({
      restoredInvestments: base, currentInvestments: base,
      operatingKrw: 0, date: '2026-10-21', toKRW, compareActiveNow: false })
    expect(c.activeNow).toBeNull()
  })
})
