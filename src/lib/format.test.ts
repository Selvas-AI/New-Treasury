import { describe, it, expect } from 'vitest'
import {
  fmtKRW, normDate, calcReturn,
  fmtReturn, returnBadgeClass, calcDday, calcBondValue, makeIssueKey,
} from './format'
import { isBusinessDay } from './bizDay'

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
  // ⚠ 평일 케이스 날짜를 고를 때는 공휴일·대체공휴일 목록(bizDay.ts)을 반드시 확인할 것.
  //   기존에 쓰던 2026-05-25 는 부처님오신날(5/24 일요일)의 대체공휴일이라
  //   "평범한 월요일"이 아니었고, 그래서 이 테스트가 계속 실패하고 있었다.
  it('월요일 → 영업일', () => expect(isBusinessDay('2026-05-18')).toBe(true))
  it('토요일 → 비영업일', () => expect(isBusinessDay('2026-05-23')).toBe(false))
  it('대체공휴일(부처님오신날, 월) → 비영업일', () => expect(isBusinessDay('2026-05-25')).toBe(false))
  it('공휴일(삼일절) → 비영업일', () => expect(isBusinessDay('2026-03-01')).toBe(false))
  it('2027 추석 → 비영업일', () => expect(isBusinessDay('2027-09-22')).toBe(false))
  it('2028 신정 대체 → 비영업일', () => expect(isBusinessDay('2028-01-03')).toBe(false))
})

// ─── calcDday ────────────────────────────────────────────
// ⚠ toISOString()은 UTC 기준이라, KST 자정~09시(UTC 기준 아직 전날)에 테스트를
//   돌리면 로컬 날짜보다 하루 이른 문자열이 만들어져 실패한다. calcDday 자체는
//   로컬 자정 기준으로 정확하므로(format.ts), 픽스처도 로컬 날짜로 만든다.
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
describe('calcDday', () => {
  it('미래 30일 → 30', () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    expect(calcDday(localDateStr(future))).toBe(30)
  })
  it('오늘 → 0', () => {
    expect(calcDday(localDateStr(new Date()))).toBe(0)
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
