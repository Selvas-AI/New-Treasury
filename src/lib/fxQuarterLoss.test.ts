import { describe, it, expect } from 'vitest'
import { quarterOf, quarterRealizedLossKRW } from './fxQuarterLoss'

describe('quarterOf', () => {
  it('분기 키와 경계', () => {
    expect(quarterOf('2026-11-25')).toEqual({ key: '2026q4', start: '2026-10-01', end: '2026-12-31' })
    expect(quarterOf('2026-02-10')).toEqual({ key: '2026q1', start: '2026-01-01', end: '2026-03-31' })
    expect(quarterOf('2026-06-30').end).toBe('2026-06-30')
  })
})

describe('quarterRealizedLossKRW — 원장에서 분기별로 (F-08)', () => {
  const rows = [
    { disposed_date: '2026-09-20', realized_pnl: -500_000_000, txn_type: 'sale' },   // 지난 분기
    { disposed_date: '2026-10-05', realized_pnl: -80_000_000,  txn_type: 'sale' },
    { disposed_date: '2026-11-03', realized_pnl:  30_000_000,  txn_type: 'sale' },
    { disposed_date: '2026-11-10', realized_pnl: -999_000_000, txn_type: 'transfer' }, // 재평가 대체 — 제외(D3)
    { disposed_date: '2026-11-12', realized_pnl: -10_000_000,  txn_type: 'payment' },  // 대외 지급 — 제외
  ]
  it('지난 분기 손실은 이번 분기 한도를 깎지 않는다 (과거: 수동 값이 영구 누적)', () => {
    const r = quarterRealizedLossKRW(rows, '2026-11-25')
    expect(r.quarter.key).toBe('2026q4')
    expect(r.lossKRW).toBe(50_000_000)   // −8천 + 3천 = −5천만
  })
  it('같은 분기의 이익과 손실은 상계한다 — 이익이 크면 손실 0', () => {
    const r = quarterRealizedLossKRW([{ disposed_date: '2026-10-01', realized_pnl: 10, txn_type: 'sale' }], '2026-11-25')
    expect(r.lossKRW).toBe(0)
  })
  it('거래 유형을 넓힐 수 있다', () => {
    expect(quarterRealizedLossKRW(rows, '2026-11-25', ['sale', 'transfer']).lossKRW).toBe(1_049_000_000)
  })
})
