import { describe, it, expect } from 'vitest'
import { planRollover, isRolloverError, rolloverInterest } from './rollover'
import { investBreakdownOn, wasOpenOnAnalysis } from './flowBridge'
import type { InvestmentRecord } from '../types'

const toKRW = (n: number, c: string) => (c === 'USD' ? n * 1400 : n)

/** 실사례 모델 — 기업은행 USD 정기예금, 05-23 개시 08-21 만기 */
function deposit(p: Partial<InvestmentRecord> = {}): InvestmentRecord {
  return {
    id: 'dep-1', company: '셀바스헬스케어', bank: '기업은행', product: '정기예금',
    currency: 'USD', amount: 2_000_000, available: '가용', rate: 3.67,
    start: '2026-05-23', maturity: '2026-08-21', active: true,
    closed_date: null, acquisition_cost: 0,
    ...p,
  } as InvestmentRecord
}

describe('planRollover — 입력 검증', () => {
  const ok = { closeDate: '2026-08-21', newMaturity: '2026-11-23', newAmount: 2_000_000, newRate: 3.5 }

  it('새 만기일이 개시일보다 앞서면 거부한다', () => {
    const r = planRollover(deposit(), { ...ok, newMaturity: '2026-08-01' }, 'new-1')
    expect(isRolloverError(r)).toBe(true)
  })

  it('금액이 0 이하면 거부한다', () => {
    expect(isRolloverError(planRollover(deposit(), { ...ok, newAmount: 0 }, 'new-1'))).toBe(true)
  })

  it('종료일이 기존 개시일보다 앞서면 거부한다 — 존재하지 않던 기간이 생긴다', () => {
    const r = planRollover(deposit(), { ...ok, closeDate: '2026-05-01' }, 'new-1')
    expect(isRolloverError(r)).toBe(true)
  })

  it('국채는 연장 대상이 아니다', () => {
    const r = planRollover(deposit({ product: '국채' }), ok, 'new-1')
    expect(isRolloverError(r)).toBe(true)
  })
})

describe('planRollover — 새 건 생성', () => {
  const opts = { closeDate: '2026-08-21', newMaturity: '2026-11-23', newAmount: 2_010_000, newRate: 3.5 }

  it('개시일과 종료일을 붙여 연속성을 만든다', () => {
    const r = planRollover(deposit(), opts, 'new-1')
    if (isRolloverError(r)) throw new Error(r.error)
    expect(r.closeDate).toBe('2026-08-21')
    expect(r.next.start).toBe('2026-08-21')   // 하루도 벌어지지 않는다
    expect(r.next.maturity).toBe('2026-11-23')
  })

  it('은행·상품·통화·가용여부를 승계하고 기간·금액·금리만 새로 잡는다', () => {
    const r = planRollover(deposit(), opts, 'new-1')
    if (isRolloverError(r)) throw new Error(r.error)
    expect(r.next.bank).toBe('기업은행')
    expect(r.next.product).toBe('정기예금')
    expect(r.next.currency).toBe('USD')
    expect(r.next.available).toBe('가용')
    expect(r.next.amount).toBe(2_010_000)
    expect(r.next.rate).toBe(3.5)
  })

  it('새 건은 활성이고 종료일이 없다', () => {
    const r = planRollover(deposit(), opts, 'new-1')
    if (isRolloverError(r)) throw new Error(r.error)
    expect(r.next.active).toBe(true)
    expect(r.next.closed_date).toBeNull()
    expect(r.next.id).toBe('new-1')           // 기존 id 를 재사용하지 않는다
  })

  it('늘어난 금액은 이자 재예치분이다', () => {
    expect(rolloverInterest(deposit(), 2_010_000)).toBe(10_000)
  })
})

// ⭐ 이 기능의 목적 검증 — 연장 후에도 **과거 잔액이 그대로 남는가**.
//   기존 방식(레코드 수정)에서는 6/25 잔액이 0 이 됐다. 그것이 이 작업의 출발점이었다.
describe('연장 후 과거 재구성', () => {
  const opts = { closeDate: '2026-08-21', newMaturity: '2026-11-23', newAmount: 2_000_000, newRate: 3.5 }

  /** 연장 처리 후의 DB 상태를 그대로 재현 */
  function afterRollover(): InvestmentRecord[] {
    const r = planRollover(deposit(), opts, 'new-1')
    if (isRolloverError(r)) throw new Error(r.error)
    const closed: InvestmentRecord = {
      ...deposit(), active: false, closed_date: r.closeDate,
    }
    return [closed, r.next]
  }

  it('연장 전 날짜(6/25)에도 예금이 잡힌다 — 이것이 안 되던 문제였다', () => {
    const bd = investBreakdownOn(afterRollover(), '2026-06-25', toKRW)
    expect(bd.availKrw).toBe(2_000_000 * 1400)
  })

  it('그 시점에 살아 있던 건은 기존 건 하나뿐이다 — 이중 계상되지 않는다', () => {
    const [closed, next] = afterRollover()
    expect(wasOpenOnAnalysis(closed, '2026-06-25').open).toBe(true)
    expect(wasOpenOnAnalysis(next,   '2026-06-25').open).toBe(false)
  })

  it('연장 이후 날짜(9/10)에는 새 건만 잡힌다', () => {
    const [closed, next] = afterRollover()
    expect(wasOpenOnAnalysis(closed, '2026-09-10').open).toBe(false)
    expect(wasOpenOnAnalysis(next,   '2026-09-10').open).toBe(true)
    const bd = investBreakdownOn(afterRollover(), '2026-09-10', toKRW)
    expect(bd.availKrw).toBe(2_000_000 * 1400)   // 두 건이 겹쳐 두 배가 되지 않는다
  })

  it('경계일(8/21) — 종료일 당일은 새 건으로 넘어간다', () => {
    const [closed, next] = afterRollover()
    // closed_date > date 가 열림 조건이므로 종료일 당일은 닫힘
    expect(wasOpenOnAnalysis(closed, '2026-08-21').open).toBe(false)
    expect(wasOpenOnAnalysis(next,   '2026-08-21').open).toBe(true)
    const bd = investBreakdownOn(afterRollover(), '2026-08-21', toKRW)
    expect(bd.availKrw).toBe(2_000_000 * 1400)   // 빈 날도, 겹치는 날도 없다
  })

  it('추정(만기추정)에 기대지 않는다 — closed_date 가 정확히 남기 때문', () => {
    const [closed] = afterRollover()
    expect(wasOpenOnAnalysis(closed, '2026-06-25').inferred).toBe(false)
  })
})
