import { describe, it, expect } from 'vitest'
import { wasOpenOn, isOpenOn } from './treasuryCalc'

/**
 * point-in-time 판정 — 자금일보 자금현황의 기초·마감 잔액과 대시보드 현금흐름 추이가
 * 같은 규칙을 쓴다. 여기서 규칙이 갈리면 두 화면의 잔액이 어긋난다.
 */
describe('wasOpenOn', () => {
  it('closed_date 가 있으면 그 날짜 기준으로 판정한다 (닫힌 당일은 이미 닫힌 것)', () => {
    const rec = { active: false, closed_date: '2026-08-20' }
    expect(wasOpenOn(rec, '2026-08-19')).toBe(true)
    expect(wasOpenOn(rec, '2026-08-20')).toBe(false)
    expect(wasOpenOn(rec, '2026-08-21')).toBe(false)
  })

  it('closed_date 가 없고 active=false 인 레거시 건은 항상 닫힌 것으로 본다', () => {
    // 세션19차 Task 6 회귀: "closed_date 없음 = 열려있음" 으로 보면 이미 상환된 자금까지 산입된다
    expect(wasOpenOn({ active: false, closed_date: null }, '2026-01-01')).toBe(false)
  })

  it('active=true 면 closed_date 여부와 무관하게 열려 있다', () => {
    expect(wasOpenOn({ active: true, closed_date: null }, '2026-08-20')).toBe(true)
  })
})

describe('isOpenOn', () => {
  const rec = { active: true, closed_date: null, start: '2026-08-20' }

  it('개시일 이전 날짜에는 잔액으로 잡히지 않는다', () => {
    expect(isOpenOn(rec, '2026-08-19')).toBe(false)
  })

  it('개시일 당일부터 잔액으로 잡힌다', () => {
    expect(isOpenOn(rec, '2026-08-20')).toBe(true)
    expect(isOpenOn(rec, '2026-08-21')).toBe(true)
  })

  it('신규 집행 건은 기초(전일)에는 없고 마감(당일)에만 있다 — Δ 로 드러난다', () => {
    // 중금채 30억 신규 등록 사례: 기초·마감 양쪽에 같은 값이 들어가면 Δ=0 이 되어 표에서 사라진다
    expect(isOpenOn(rec, '2026-08-19')).toBe(false)  // 기초
    expect(isOpenOn(rec, '2026-08-20')).toBe(true)   // 마감
  })

  it('해지 건은 기초에는 남고 마감에서 빠진다', () => {
    const closed = { active: false, closed_date: '2026-08-20', start: '2026-01-02' }
    expect(isOpenOn(closed, '2026-08-19')).toBe(true)
    expect(isOpenOn(closed, '2026-08-20')).toBe(false)
  })

  it('개시일 미기재(레거시)는 항상 개시된 것으로 본다', () => {
    expect(isOpenOn({ active: true, closed_date: null, start: '' }, '2020-01-01')).toBe(true)
  })

  it('기준일이 비어 있으면(초기 렌더) active 플래그 그대로 — 기존 동작 폴백', () => {
    expect(isOpenOn(rec, '')).toBe(true)
    expect(isOpenOn({ active: false, closed_date: null, start: '2020-01-01' }, '')).toBe(false)
  })
})
