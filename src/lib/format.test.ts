import { describe, it, expect } from 'vitest'
import {
  fmtKRW, normDate, calcReturn, isBusinessDay,
  fmtReturn, returnBadgeClass, calcDday, calcBondValue, makeIssueKey,
} from './format'

// ─── fmtKRW ──────────────────────────────────────────────
describe('fmtKRW', () => {
  it('억 단위 포맷', () => expect(fmtKRW(5_644_864_146)).toBe('56.4억원'))
  it('만 단위 포맷', () => expect(fmtKRW(50_000)).toBe('5만원'))
  it('음수 처리', () => expect(fmtKRW(-100_000_000)).toBe('-1.0억원'))
  it('0 처리', () => expect(fmtKRW(0)).toBe('0원'))
})

// ─── normDate ────────────────────────────────────────────
describe('normDate', () => {
  it('YYYYMMDD → YYYY-MM-DD', () => expect(normDate('20260521')).toBe('2026-05-21'))
  it('이미 YYYY-MM-DD면 그대로', () => expect(normDate('2026-05-21')).toBe('2026-05-21'))
  it('null 처리', () => expect(normDate(null)).toBe(''))
})

// ─── calcReturn ──────────────────────────────────────────
describe('calcReturn', () => {
  it('수익률 계산', () => expect(calcReturn(25_000_000, 20_000_000)).toBeCloseTo(25))
  it('취득가액 0이면 null', () => expect(calcReturn(100, 0)).toBeNull())
})

// ─── fmtReturn ───────────────────────────────────────────
describe('fmtReturn', () => {
  it('양수 수익률 + 기호', () => expect(fmtReturn(5.5)).toBe('+5.50%'))
  it('음수 수익률', () => expect(fmtReturn(-3.2)).toBe('-3.20%'))
  it('null → -', () => expect(fmtReturn(null)).toBe('-'))
})

// ─── returnBadgeClass ────────────────────────────────────
describe('returnBadgeClass', () => {
  it('양수 → 빨강', () => expect(returnBadgeClass(5)).toContain('red'))
  it('음수 → 파랑', () => expect(returnBadgeClass(-5)).toContain('blue'))
  it('null → 회색', () => expect(returnBadgeClass(null)).toContain('gray'))
})

// ─── isBusinessDay ───────────────────────────────────────
describe('isBusinessDay', () => {
  it('월요일 → 영업일', () => expect(isBusinessDay(new Date('2026-05-25'))).toBe(true))
  it('토요일 → 비영업일', () => expect(isBusinessDay(new Date('2026-05-23'))).toBe(false))
  it('공휴일(삼일절) → 비영업일', () => expect(isBusinessDay(new Date('2026-03-01'))).toBe(false))
})

// ─── calcDday ────────────────────────────────────────────
describe('calcDday', () => {
  it('미래 30일 → 30', () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    expect(calcDday(future.toISOString().slice(0, 10))).toBe(30)
  })
  it('오늘 → 0', () => {
    expect(calcDday(new Date().toISOString().slice(0, 10))).toBe(0)
  })
})

// ─── calcBondValue ───────────────────────────────────────
describe('calcBondValue', () => {
  it('좌수 × 기준가÷10', () => expect(calcBondValue(10000, 7408)).toBeCloseTo(7_408_000))
})

// ─── makeIssueKey ────────────────────────────────────────
describe('makeIssueKey', () => {
  it('loan 키', () => expect(makeIssueKey('loan', 'abc-123')).toBe('loan_abc-123'))
  it('equity 키', () => expect(makeIssueKey('equity', '삼성전자')).toBe('equity_삼성전자'))
  it('input_daily 키', () => expect(makeIssueKey('input_daily')).toBe('input_daily'))
})
