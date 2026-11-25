import { describe, it, expect } from 'vitest'
import { computeReconcilePending, lotCreatedDate, type ReconcileLot, type ReconcileConsumption } from './fxReconcile'

// 단순 영업일: 주말만 건너뜀(테스트 날짜는 모두 평일)
const prevBiz = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`)
  do { t.setUTCDate(t.getUTCDate() - 1) } while ([0, 6].includes(t.getUTCDay()))
  return t.toISOString().slice(0, 10)
}

/** daily[X] = 전영업일 마감. 화(11-18) 작성분이 월(11-17) 거래를 담는다 */
const daily = (values: [string, number][]) => values.map(([date, value], i) => ({ id: `d${i}`, date, value }))

const lot = (o: Partial<ReconcileLot> & { id: string }): ReconcileLot => ({
  account_type: 'demand_deposit', source_type: 'manual', acquired_date: '2026-01-01',
  original_amount: 0, ...o,
})

function run(dailyRows: ReturnType<typeof daily>, lots: ReconcileLot[], cons: ReconcileConsumption[] = [],
             transferDates = new Map<string, string>()) {
  return computeReconcilePending({ daily: dailyRows, lots, consumptions: cons, transferDates,
    ignored: new Set(), prevBizDay: prevBiz })
}

const OPEN = lot({ id: 'open', source_type: 'opening', original_amount: 10_000_000 })

describe('computeReconcilePending — 운전 계좌 기준 대사 (F-03)', () => {
  it('정기예금 만기 → 보통예금 대체는 미반영이 아니다 (과거: 가짜 유입 5M → 반영 시 이중 계상)', () => {
    // 11-17(월) 거래: 정기예금 5M 해지 → 보통예금. carryover 로트는 원본 취득일(03-11)을 승계한다
    const td = lot({ id: 'td', account_type: 'term_deposit', source_type: 'opening', original_amount: 5_000_000 })
    const moved = lot({ id: 'mv', account_type: 'demand_deposit', source_type: 'transfer',
      acquired_date: '2026-03-11', transfer_id: 't1', original_amount: 5_000_000 })
    const r = run(daily([['2026-11-17', 1_000_000], ['2026-11-18', 6_000_000]]),
      [OPEN, td, moved],
      [{ lot_id: 'td', disposed_date: '2026-11-17', amount: 5_000_000 }],
      new Map([['t1', '2026-11-17']]))
    expect(r).toEqual([])
  })

  it('보통예금 → 정기예금 예치도 미반영이 아니다 (과거: 가짜 유출 → 반영 시 로트 실제 소진)', () => {
    const src = lot({ id: 'dd', original_amount: 4_000_000 })
    const newTd = lot({ id: 'nt', account_type: 'term_deposit', source_type: 'transfer',
      acquired_date: '2026-01-01', transfer_id: 't2', original_amount: 3_000_000 })
    const r = run(daily([['2026-11-17', 4_000_000], ['2026-11-18', 1_000_000]]),
      [src, newTd],
      [{ lot_id: 'dd', disposed_date: '2026-11-17', amount: 3_000_000 }],
      new Map([['t2', '2026-11-17']]))
    expect(r).toEqual([])
  })

  it('해지 이자가 보통예금으로 들어오면 원장 이자 로트와 상계된다', () => {
    const interest = lot({ id: 'i', source_type: 'interest', acquired_date: '2026-11-17', original_amount: 10_000 })
    expect(run(daily([['2026-11-17', 1_000_000], ['2026-11-18', 1_010_000]]), [interest])).toEqual([])
  })

  it('이자를 정기예금에 재예치하면 운전 잔액 변화가 없고 미반영도 없다', () => {
    const interestTd = lot({ id: 'i2', account_type: 'term_deposit', source_type: 'interest',
      acquired_date: '2026-11-17', original_amount: 10_000 })
    expect(run(daily([['2026-11-17', 1_000_000], ['2026-11-18', 1_000_000]]), [interestTd])).toEqual([])
  })

  it('매각 체결(운전 로트 소진)은 미반영이 아니다', () => {
    const dd = lot({ id: 'dd', original_amount: 3_000_000 })
    const r = run(daily([['2026-11-17', 3_000_000], ['2026-11-18', 2_000_000]]), [dd],
      [{ lot_id: 'dd', disposed_date: '2026-11-17', amount: 1_000_000 }])
    expect(r).toEqual([])
  })

  it('자금일보를 하루 건너뛰면 이틀치 원장 거래를 모두 차감한다', () => {
    // 11-17(월) 다음 행이 11-20(목) — 그 사이 11-17·11-18·11-19 거래가 모두 한 증감에 담긴다
    const dd = lot({ id: 'dd', original_amount: 5_000_000 })
    const r = run(daily([['2026-11-17', 5_000_000], ['2026-11-20', 3_000_000]]), [dd], [
      { lot_id: 'dd', disposed_date: '2026-11-17', amount: 1_000_000 },
      { lot_id: 'dd', disposed_date: '2026-11-19', amount: 1_000_000 },
    ])
    expect(r).toEqual([])
  })

  it('원장이 모르는 대외 지급은 미반영 유출로 남는다', () => {
    const r = run(daily([['2026-11-17', 2_000_000], ['2026-11-18', 1_500_000]]), [OPEN])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ direction: 'out', amount: 500_000, txnDate: '2026-11-17', date: '2026-11-18' })
  })

  it('개시 로트는 거래로 세지 않는다', () => {
    const r = run(daily([['2026-11-17', 0], ['2026-11-18', 0]]),
      [lot({ id: 'o', source_type: 'opening', acquired_date: '2026-11-17', original_amount: 9_999 })])
    expect(r).toEqual([])
  })
})

describe('lotCreatedDate — 대체 로트는 대체일에 생긴다', () => {
  it('available_from 이 있으면 그 값', () => {
    expect(lotCreatedDate(lot({ id: 'a', available_from: '2026-11-20', acquired_date: '2026-01-01' }), new Map())).toBe('2026-11-20')
  })
  it('없으면 대체 이력 날짜, 그것도 없으면 취득일', () => {
    expect(lotCreatedDate(lot({ id: 'b', transfer_id: 't', acquired_date: '2026-01-01' }), new Map([['t', '2026-11-17']]))).toBe('2026-11-17')
    expect(lotCreatedDate(lot({ id: 'c', acquired_date: '2026-05-05' }), new Map())).toBe('2026-05-05')
  })
})
