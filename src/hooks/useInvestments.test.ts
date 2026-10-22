import { describe, it, expect } from 'vitest'
import { investFromDb, getLatestBonds } from './useInvestments'
import type { InvestmentRecord } from '../types'

/**
 * 2026-10-22 실사고 회귀 테스트 — 자금흐름 분석에서 국채가 두 줄로 중복 집계됐다.
 *
 * 경위: audit_logs 스냅샷으로 과거를 복원할 때, setActive·remove 가 남긴 스냅샷이
 *   **camelCase 레코드** 라 investFromDb 가 bond_* 를 못 읽었다. 그 결과 그 행만
 *   dedup 키가 bondTicker → bank 로 떨어져 같은 국채가 두 묶음이 됐고,
 *   가용 국채가 55.7억 → 109.6억으로 부풀었다.
 */
describe('investFromDb — 감사 스냅샷 내성', () => {
  it('snake_case(DB 행)를 읽는다', () => {
    const r = investFromDb({
      id: 'a', company: 'X', bank: '국고02625-5503(25-2)', product: '국채',
      bond_ticker: 'KR103502GF39', bond_name: '국고02625-5503(25-2)',
      bond_qty: 7_619_957, bond_price: 7315, start_date: '2026-10-20',
    })
    expect(r.bondTicker).toBe('KR103502GF39')
    expect(r.bondQty).toBe(7_619_957)
    expect(r.priceDate).toBe('2026-10-20')
  })

  it('camelCase 스냅샷(감사 로그)도 읽는다 — 식별자가 사라지면 중복 집계된다', () => {
    const r = investFromDb({
      id: 'a', company: 'X', bank: '국고02625-5503(25-2)', product: '국채',
      bondTicker: 'KR103502GF39', bondName: '국고02625-5503(25-2)',
      bondQty: 7_619_957, bondPrice: 7315, start: '2026-10-20',
    })
    expect(r.bondTicker).toBe('KR103502GF39')
    expect(r.bondQty).toBe(7_619_957)
    expect(r.bondPrice).toBe(7315)
    expect(r.priceDate).toBe('2026-10-20')
  })
})

function bond(p: Partial<InvestmentRecord>): InvestmentRecord {
  return {
    id: p.id ?? Math.random().toString(36), company: 'X', bank: '국고02625-5503(25-2)',
    product: '국채', currency: 'KRW', amount: 0, available: '가용', rate: 0,
    start: '', maturity: '', active: true, closed_date: null, acquisition_cost: 0,
    ...p,
  } as InvestmentRecord
}

describe('getLatestBonds — 같은 종목은 한 묶음', () => {
  it('기준일별 이력 113행이라도 최신 1건만 남는다', () => {
    const rows = Array.from({ length: 113 }, (_, i) =>
      bond({ id: `r${i}`, bondTicker: 'KR103502GF39', bondName: '국고02625-5503(25-2)',
             priceDate: `2026-07-${String((i % 28) + 1).padStart(2, '0')}` }))
    expect(getLatestBonds(rows)).toHaveLength(1)
  })

  it('[회귀] 티커를 잃은 행이 섞여도 두 묶음으로 갈리지 않는다', () => {
    const rows = [
      bond({ id: 'ok',   bondTicker: 'KR103502GF39', bondName: '국고02625-5503(25-2)', priceDate: '2026-10-20' }),
      // 감사 로그 복원분 — 티커·종목명을 잃어 bank 만 남은 행
      bond({ id: 'lost', bondTicker: undefined, bondName: undefined, priceDate: '2026-09-30' }),
    ]
    const latest = getLatestBonds(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].id).toBe('ok')     // 더 최신 기준일 쪽이 남는다
  })

  it('종목명만 남은 행도 티커 쪽으로 합쳐진다', () => {
    const rows = [
      bond({ id: 'ok',   bondTicker: 'KR103502GF39', bondName: '국고02625-5503(25-2)', priceDate: '2026-09-01' }),
      bond({ id: 'lost', bondTicker: undefined, bondName: '국고02625-5503(25-2)', priceDate: '2026-10-20' }),
    ]
    expect(getLatestBonds(rows)).toHaveLength(1)
  })

  it('서로 다른 국채는 그대로 분리된다', () => {
    const rows = [
      bond({ id: 'a', bank: 'A', bondTicker: 'KR1', bondName: '국고A', priceDate: '2026-10-20' }),
      bond({ id: 'b', bank: 'B', bondTicker: 'KR2', bondName: '국고B', priceDate: '2026-10-20' }),
    ]
    expect(getLatestBonds(rows)).toHaveLength(2)
  })
})
