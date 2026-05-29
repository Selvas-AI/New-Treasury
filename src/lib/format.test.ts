import { describe, it, expect } from 'vitest'
import { fmtKRW, normDate, calcReturn, isBusinessDay } from './format'

describe('fmtKRW', () => {
  it('억 단위 포맷', () => {
    expect(fmtKRW(5_644_864_146)).toBe('56.4억원')
  })
  it('만 단위 포맷', () => {
    expect(fmtKRW(50_000)).toBe('5만원')
  })
  it('음수 처리', () => {
    expect(fmtKRW(-100_000_000)).toBe('-1.0억원')
  })
  it('0 처리', () => {
    expect(fmtKRW(0)).toBe('0원')
  })
})

describe('normDate', () => {
  it('YYYYMMDD → YYYY-MM-DD', () => {
    expect(normDate('20260521')).toBe('2026-05-21')
  })
  it('이미 YYYY-MM-DD면 그대로', () => {
    expect(normDate('2026-05-21')).toBe('2026-05-21')
  })
  it('null 처리', () => {
    expect(normDate(null)).toBe('')
  })
})

describe('calcReturn', () => {
  it('수익률 계산', () => {
    expect(calcReturn(25_000_000, 20_000_000)).toBeCloseTo(25)
  })
  it('취득가액 0이면 null', () => {
    expect(calcReturn(100, 0)).toBeNull()
  })
})