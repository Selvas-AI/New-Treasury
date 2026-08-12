import { describe, expect, it } from 'vitest'
import {
  consumeFifoLots, previewFifoConsumption, weightedBookRate,
  isLotAvailable, availableAmount, type FxLot,
} from './fxLots'

const lot = (over: Partial<FxLot>): FxLot => ({
  id: 'x', company: '메디아나', currency: 'USD', acquiredDate: '2026-01-01',
  originalAmount: 100, remainingAmount: 100, acqRate: 1400,
  accountType: 'demand_deposit', annualInterestRate: 0, sourceType: 'opening', ...over,
})

const lots: FxLot[] = [
  { id: 'old', company: '메디아나', currency: 'USD', acquiredDate: '2026-01-01', originalAmount: 100,
    remainingAmount: 100, acqRate: 1500, accountType: 'demand_deposit', annualInterestRate: 0, sourceType: 'opening' },
  { id: 'new', company: '메디아나', currency: 'USD', acquiredDate: '2026-02-01', originalAmount: 100,
    remainingAmount: 100, acqRate: 1300, accountType: 'demand_deposit', annualInterestRate: 0, sourceType: 'manual' },
]

describe('계좌 유형별 환전 가능성', () => {
  // ⚠ 과거 구현은 'demand_deposit' 만 허용하는 화이트리스트였다.
  //   그래서 mmda 가 추가됐을 때 조용히 잠긴 것으로 취급돼 환전 가능액이 과소 계산됐다.
  it('보통예금은 항상 환전 가능', () => {
    expect(isLotAvailable(lot({ accountType: 'demand_deposit' }), '2026-08-12')).toBe(true)
  })
  it('mmda 는 만기가 없어도 환전 가능 (수시입출식)', () => {
    expect(isLotAvailable(lot({ accountType: 'mmda', maturityDate: null }), '2026-08-12')).toBe(true)
  })
  it('정기예금은 만기 전 잠김 / 만기일부터 가능', () => {
    const td = lot({ accountType: 'term_deposit', maturityDate: '2026-09-11' })
    expect(isLotAvailable(td, '2026-09-10')).toBe(false)
    expect(isLotAvailable(td, '2026-09-11')).toBe(true)   // 만기일 당일 포함
    expect(isLotAvailable(td, '2026-09-12')).toBe(true)
  })
  it('만기 전 정기예금은 환전 가능액과 FIFO 후보에서 빠진다', () => {
    const mixed = [
      lot({ id: 'dd', accountType: 'demand_deposit', remainingAmount: 100 }),
      lot({ id: 'mm', accountType: 'mmda', remainingAmount: 200, annualInterestRate: 3 }),
      lot({ id: 'td', accountType: 'term_deposit', remainingAmount: 6000, maturityDate: '2026-09-17' }),
    ]
    expect(availableAmount(mixed, '2026-08-12')).toBe(300)      // 정기예금 6000 제외
    expect(availableAmount(mixed, '2026-09-17')).toBe(6300)     // 만기 후 포함
    const rows = previewFifoConsumption(mixed, 6300, 1500, '2026-08-12')
    expect(rows.map(r => r.lotId)).toEqual(['dd', 'mm'])         // td 는 후보에서 제외
  })
})

describe('fxLots FIFO', () => {
  it('오래된 로트부터 소진한다', () => {
    const rows = previewFifoConsumption(lots, 150, 1400)
    expect(rows.map(row => [row.lotId, row.amount])).toEqual([['old', 100], ['new', 50]])
  })

  it('실현손익과 잔존 장부환율을 계산한다', () => {
    const result = consumeFifoLots(lots, 100, 1400)
    expect(result.realizedPnlKRW).toBe(-10_000)
    expect(weightedBookRate(result.nextLots)).toBe(1300)
    expect(lots[0].remainingAmount).toBe(100)
  })

  it('정기예금은 만기일 전에는 FIFO 소진하지 않고 만기일부터 소진한다', () => {
    const term: FxLot = { ...lots[0], id: 'term', accountType: 'term_deposit',
      annualInterestRate: 3.5, maturityDate: '2026-09-11' }
    expect(previewFifoConsumption([term, lots[1]], 100, 1400, '2026-09-10')[0].lotId).toBe('new')
    expect(previewFifoConsumption([term, lots[1]], 100, 1400, '2026-09-11')[0].lotId).toBe('term')
  })
})
