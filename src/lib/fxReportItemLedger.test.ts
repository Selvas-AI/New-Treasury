import { describe, it, expect } from 'vitest'
import {
  isLedgerCategory, reportItemLedgerState, isLedgerRpcMissing,
  NON_LEDGER_CATEGORIES, DUPLICATE_RISK_HINT,
  previewReportItemOutflow, reportItemRateLabel, isReportItemFxAccount,
} from './fxReportItemLedger'
import type { FxLot } from './fxLots'

/**
 * 자금일보 외화 항목 → 외화거래명세 반영 규칙.
 * ⚠ 서버 RPC(sync_report_item_ledger)의 제외 카테고리와 **같아야 한다** — 아래 목록이 바뀌면
 *   docs/db/fx_report_item_ledger.sql 의 `category in (...)` 도 함께 바꿀 것.
 */
describe('isLedgerCategory — 어떤 항목이 원장 반영 대상인가', () => {
  it('외화 일반 입출금은 대상', () => {
    expect(isLedgerCategory({ currency: 'USD', category: 'ar_collection' })).toBe(true)
    expect(isLedgerCategory({ currency: 'EUR', category: 'ap_payment' })).toBe(true)
    expect(isLedgerCategory({ currency: 'JPY', category: 'loan_repayment' })).toBe(true)   // 외화 차입금 상환
  })
  it('원화는 대상 아님', () => {
    expect(isLedgerCategory({ currency: 'KRW', category: 'ar_collection' })).toBe(false)
  })
  it('평가손익·정기예금 연동은 대상 아님 — 같은 외화가 두 번 움직이지 않게', () => {
    for (const c of ['invest_eval_in', 'invest_eval_out', 'invest_execute', 'invest_return']) {
      expect(isLedgerCategory({ currency: 'USD', category: c })).toBe(false)
    }
  })
  it('서버 SQL 과 같은 제외 목록', () => {
    expect(Object.keys(NON_LEDGER_CATEGORIES).sort())
      .toEqual(['invest_eval_in', 'invest_eval_out', 'invest_execute', 'invest_return'])
  })
  it('이자수익은 대상이되 중복 위험을 안내한다(정기예금 해지 이자)', () => {
    expect(isLedgerCategory({ currency: 'USD', category: 'interest_income' })).toBe(true)
    expect(DUPLICATE_RISK_HINT.interest_income).toBeTruthy()
  })
})

describe('reportItemLedgerState — 행 배지', () => {
  const reflected = new Set(['a'])
  it('반영됨', () => {
    expect(reportItemLedgerState({ id: 'a', currency: 'USD', category: 'ap_payment', fx_rate: 1400 }, reflected)).toBe('reflected')
  })
  it('환율이 없으면 "환율 입력 시 반영"', () => {
    expect(reportItemLedgerState({ id: 'b', currency: 'USD', category: 'ap_payment', fx_rate: null }, reflected)).toBe('missing_rate')
  })
  it('환율은 있는데 원장에 없으면 "미반영"(실패·설정 미적용) — 조용히 넘어가지 않는다', () => {
    expect(reportItemLedgerState({ id: 'c', currency: 'USD', category: 'ap_payment', fx_rate: 1400 }, reflected)).toBe('pending')
  })
  it('원화·평가손익은 배지 없음', () => {
    expect(reportItemLedgerState({ id: 'd', currency: 'KRW', category: 'ap_payment' }, reflected)).toBe('not_applicable')
    expect(reportItemLedgerState({ id: 'e', currency: 'USD', category: 'invest_eval_in', fx_rate: 1400 }, reflected)).toBe('not_applicable')
  })
})

describe('isLedgerRpcMissing — SQL 미적용 안내', () => {
  it('함수 없음 오류를 알아본다', () => {
    expect(isLedgerRpcMissing('Could not find the function public.sync_report_item_ledger')).toBe(true)
  })
  it('잔액 부족 같은 실제 오류는 그대로 보여준다', () => {
    expect(isLedgerRpcMissing('FIFO 잔액 부족: 1000')).toBe(false)
  })
})

// ── 계좌구분 (2026-11-26) ───────────────────────────────────────────────

const lot = (id: string, acct: FxLot['accountType'], amount: number, rate: number, acquired: string): FxLot => ({
  id, company: 'c', currency: 'USD', acquiredDate: acquired, originalAmount: amount, remainingAmount: amount,
  acqRate: rate, accountType: acct, annualInterestRate: 0, maturityDate: null, sourceType: 'opening',
})

describe('previewReportItemOutflow — 계좌별 선입선출 미리보기', () => {
  const lots = [
    lot('d1', 'demand_deposit', 1000, 1300, '2026-01-01'),
    lot('m1', 'mmda', 500, 1400, '2025-12-01'),   // 더 오래됐지만 MMDA
    lot('m2', 'mmda', 500, 1350, '2026-02-01'),
  ]

  it('선택한 계좌 로트만 소진한다 — 다른 계좌의 더 오래된 로트를 건드리지 않는다', () => {
    const p = previewReportItemOutflow(lots, 'demand_deposit', 400, '2026-11-25', 1450)
    expect(p.bookRate).toBe(1300)
    expect(p.available).toBe(1000)
    expect(p.pnlKRW).toBeCloseTo(400 * 150)
  })

  it('MMDA 는 MMDA 안에서 취득일 순 — 장부환율은 소진 로트의 수량가중', () => {
    const p = previewReportItemOutflow(lots, 'mmda', 700, '2026-11-25', null)
    expect(p.bookRate).toBeCloseTo((500 * 1400 + 200 * 1350) / 700)
    expect(p.pnlKRW).toBeNull()   // 적용환율 미입력
    expect(p.shortfall).toBe(0)
  })

  it('잔액이 부족하면 부족분을 알린다 (계좌 대체 미기록의 전형)', () => {
    const p = previewReportItemOutflow(lots, 'mmda', 1200, '2026-11-25', 1400)
    expect(p.available).toBe(1000)
    expect(p.shortfall).toBe(200)
  })

  it('거래일에 아직 장부에 없던 로트는 쓰지 않는다 (서버 available_from 규칙과 동일)', () => {
    const p = previewReportItemOutflow(lots, 'mmda', 600, '2026-01-15', 1400)
    expect(p.available).toBe(500)
    expect(p.shortfall).toBe(100)
  })
})

describe('계좌구분 보조 규칙', () => {
  it('환율 이름 — 입금은 장부환율, 출금은 적용환율', () => {
    expect(reportItemRateLabel('in')).toBe('장부환율')
    expect(reportItemRateLabel('out')).toBe('적용환율')
  })
  it('허용 계좌유형은 보통예금·MMDA 뿐 (정기예금은 운용자금 처리 경로)', () => {
    expect(isReportItemFxAccount('mmda')).toBe(true)
    expect(isReportItemFxAccount('term_deposit')).toBe(false)
    expect(isReportItemFxAccount(null)).toBe(false)
  })
})
