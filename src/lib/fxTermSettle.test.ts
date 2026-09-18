import { describe, it, expect } from 'vitest'
import type { FxLot } from './fxLots'
import type { InvestmentRecord } from '../types'
import {
  isFxTermDeposit, termStateAt, planRolloverLedger, planCloseLedger, isPlanError,
  previewTermPrincipalConsumption, revaluePnlKRW, parseValuationMethod,
} from './fxTermSettle'

function lot(p: Partial<FxLot>): FxLot {
  return {
    id: p.id ?? 'l1', company: '메디아나', currency: 'USD',
    acquiredDate: p.acquiredDate ?? '2026-06-17',
    originalAmount: p.originalAmount ?? p.remainingAmount ?? 0,
    remainingAmount: p.remainingAmount ?? 0,
    acqRate: p.acqRate ?? 1400,
    accountType: p.accountType ?? 'term_deposit',
    annualInterestRate: p.annualInterestRate ?? 0,
    maturityDate: p.maturityDate ?? null,
    sourceType: p.sourceType ?? 'opening',
  }
}

function rec(p: Partial<InvestmentRecord>): InvestmentRecord {
  return {
    id: 'i1', company: '메디아나', bank: '기업은행', product: '정기예금',
    currency: 'USD', amount: 5_000_000, available: '가용', rate: 4.1,
    start: '2026-06-17', maturity: '2026-09-17', active: true,
    acquisition_cost: 0, ...p,
  } as InvestmentRecord
}

// 실측 상황(2026-09-15 리포트): 메디아나 USD 정기예금 2건
const LOTS: FxLot[] = [
  lot({ id: 'a', acquiredDate: '2026-06-17', remainingAmount: 5_000_000, maturityDate: '2026-09-17', acqRate: 1513.5 }),
  lot({ id: 'b', acquiredDate: '2026-03-11', remainingAmount: 1_000_000, maturityDate: '2026-12-11', acqRate: 1472.4 }),
  lot({ id: 'c', acquiredDate: '2026-05-01', remainingAmount:   300_000, accountType: 'demand_deposit' }),
]

describe('isFxTermDeposit', () => {
  it('원화 정기예금은 원장 연동 대상이 아니다', () => {
    expect(isFxTermDeposit(rec({ currency: 'KRW' }))).toBe(false)
  })
  it('외화라도 상품이 정기예금이 아니면 대상이 아니다', () => {
    expect(isFxTermDeposit(rec({ product: 'MMF' }))).toBe(false)
  })
  it('외화 정기예금만 대상', () => {
    expect(isFxTermDeposit(rec({}))).toBe(true)
  })
})

describe('termStateAt', () => {
  it('정기예금만 세고 보통예금은 제외한다', () => {
    expect(termStateAt(LOTS, '2026-09-17').termTotal).toBe(6_000_000)
  })
  it('만기 도래분은 기준일 이하인 것만', () => {
    expect(termStateAt(LOTS, '2026-09-17').maturedTotal).toBe(5_000_000)
    expect(termStateAt(LOTS, '2026-09-16').maturedTotal).toBe(0)
    expect(termStateAt(LOTS, '2026-12-11').maturedTotal).toBe(6_000_000)
  })
})

describe('planRolloverLedger', () => {
  const st = termStateAt(LOTS, '2026-09-17')

  it('동액 재예치 — 원금만 정기예금으로 대체, 이자 없음, 중도해지 아님', () => {
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 5_000_000, newRate: 4.3 }, st)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.plan).toMatchObject({
      principal: 5_000_000, toAccountType: 'term_deposit', interest: 0,
      maturityDate: '2026-12-17', annualInterestRate: 4.3, allowEarly: false,
    })
    expect(r.warning).toBeNull()
  })

  it('이자 재예치 — 늘어난 금액이 이자이고 그 이자도 정기예금으로 들어간다', () => {
    // ⚠ 이자를 보통예금으로 넣으면 원장 정기예금이 운용자금보다 이자만큼 작아진다
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 5_051_000, newRate: 4.3 }, st)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.plan.interest).toBe(51_000)
    expect(r.plan.interestAccountType).toBe('term_deposit')
    expect(r.plan.maturityDate).toBe('2026-12-17')
  })

  it('만기 전 연장은 중도해지로 표시된다', () => {
    const early = termStateAt(LOTS, '2026-09-10')   // 만기 도래분 0
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-10', newMaturity: '2026-12-10', newAmount: 5_000_000, newRate: 4.3 }, early)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.plan.allowEarly).toBe(true)
  })

  it('금액이 줄어드는 연장은 거부한다 — 줄어든 돈의 행방을 추정하지 않는다', () => {
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 3_000_000, newRate: 4.3 }, st)
    expect(isPlanError(r)).toBe(true)
  })

  it('원장 정기예금 잔액이 모자라면 경고한다 (반영 시 서버가 거부할 상태)', () => {
    const r = planRolloverLedger(rec({ amount: 9_000_000 }),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 9_000_000, newRate: 4.3 }, st)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.warning).toContain('원장 정기예금 잔액')
  })

  it('새 만기일이 없으면 계획을 만들지 않는다', () => {
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '', newAmount: 5_000_000, newRate: 4.3 }, st)
    expect(isPlanError(r)).toBe(true)
  })
})

describe('planCloseLedger', () => {
  const st = termStateAt(LOTS, '2026-09-17')

  it('만기처리 — 원금이 보통예금으로 나오고 재예치 만기는 없다', () => {
    const r = planCloseLedger(rec({}),
      { closeDate: '2026-09-17', toAccountType: 'demand_deposit', interest: 0 }, st)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.plan).toMatchObject({
      principal: 5_000_000, toAccountType: 'demand_deposit',
      maturityDate: null, annualInterestRate: 0, allowEarly: false,
    })
  })

  it('이자는 원금과 같은 계좌로 받는다', () => {
    const r = planCloseLedger(rec({}),
      { closeDate: '2026-09-17', toAccountType: 'mmda', interest: 51_000 }, st)
    if (isPlanError(r)) throw new Error(r.error)
    expect(r.plan.interest).toBe(51_000)
    expect(r.plan.interestAccountType).toBe('mmda')
  })

  it('만기처리 행선지는 정기예금이 될 수 없다', () => {
    const r = planCloseLedger(rec({}),
      { closeDate: '2026-09-17', toAccountType: 'term_deposit', interest: 0 }, st)
    expect(isPlanError(r)).toBe(true)
  })
})

describe('재평가(revalue) 정책 — 2026-09-18 회계팀 확인', () => {
  const st = termStateAt(LOTS, '2026-09-17')

  it('대체환율이 없으면 계획 단계에서 막는다 (서버가 거부하기 전에)', () => {
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 5_000_000, newRate: 4.1 },
      st, { method: 'revalue' })
    expect(isPlanError(r)).toBe(true)
    if (isPlanError(r)) expect(r.error).toContain('매매기준율')
  })

  it('원가승계 정책이면 대체환율이 없어도 통과한다', () => {
    const r = planRolloverLedger(rec({}),
      { closeDate: '2026-09-17', newMaturity: '2026-12-17', newAmount: 5_000_000, newRate: 4.1 },
      st, { method: 'carryover' })
    expect(isPlanError(r)).toBe(false)
  })

  it('만기처리도 동일하게 막는다', () => {
    const r = planCloseLedger(rec({}),
      { closeDate: '2026-09-17', toAccountType: 'demand_deposit', interest: 0 },
      st, { method: 'revalue', transferRate: 0 })
    expect(isPlanError(r)).toBe(true)
  })

  /**
   * 회계팀 실제 분개(9/17 $5,000,000 재예치):
   *   차) 기타단기금융상품 5,000,000 × 1,368.30 = 6,841,500,000
   *   차) 환차손                                =   726,000,000
   *       대) 기타단기금융상품 5,000,000 × 1,513.50 = 7,567,500,000
   */
  it('회계팀 분개를 그대로 재현한다 — 환차손 726,000,000', () => {
    const rows = previewTermPrincipalConsumption(LOTS, 5_000_000, '2026-09-17', false)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lotId: 'a', amount: 5_000_000, acqRate: 1513.5 })
    expect(revaluePnlKRW(rows, 1368.3)).toBeCloseTo(-726_000_000, 0)
  })

  it('원가승계는 장부환율을 물려받으므로 손익이 0 이다', () => {
    const rows = previewTermPrincipalConsumption(LOTS, 5_000_000, '2026-09-17', false)
    expect(revaluePnlKRW(rows, rows[0].acqRate)).toBe(0)
  })

  it('만기 미도래분은 중도해지를 허용하지 않으면 소진 대상이 아니다', () => {
    // 'b' 는 만기 2026-12-11 로 미도래. 만기 도래분(a=500만)만으로는 600만을 못 채운다.
    const rows = previewTermPrincipalConsumption(LOTS, 6_000_000, '2026-09-17', false)
    expect(rows.map(r => r.lotId)).toEqual(['a'])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(5_000_000)
  })

  /**
   * ⚠ 서버 transfer_fx_lots 는 '만기 도래분 우선 → 취득일 FIFO' 로 소진한다.
   *   취득일만 보면 b(03-11)가 a(06-17)보다 앞서지만, 중도해지에서도 만기 도래분인
   *   a 가 먼저 나가야 화면 미리보기와 실제 결과가 갈라지지 않는다.
   */
  it('중도해지에서도 만기 도래분이 취득일보다 우선한다', () => {
    const rows = previewTermPrincipalConsumption(LOTS, 6_000_000, '2026-09-17', true)
    expect(rows.map(r => r.lotId)).toEqual(['a', 'b'])
    expect(rows[1].amount).toBe(1_000_000)
  })
})

describe('parseValuationMethod', () => {
  it("'revalue' 만 재평가로 읽고 나머지는 전부 원가승계로 안전 폴백한다", () => {
    expect(parseValuationMethod('revalue')).toBe('revalue')
    expect(parseValuationMethod('carryover')).toBe('carryover')
    expect(parseValuationMethod(null)).toBe('carryover')
    expect(parseValuationMethod('')).toBe('carryover')
    expect(parseValuationMethod('오타')).toBe('carryover')
  })
})
