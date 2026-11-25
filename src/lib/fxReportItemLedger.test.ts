import { describe, it, expect } from 'vitest'
import {
  isLedgerCategory, reportItemLedgerState, isLedgerRpcMissing,
  NON_LEDGER_CATEGORIES, DUPLICATE_RISK_HINT,
} from './fxReportItemLedger'

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
