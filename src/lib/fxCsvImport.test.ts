import { describe, expect, it } from 'vitest'
import {
  parseInventoryCsv, parseSalesCsv, inventoryMatchKey,
  INVENTORY_CSV_TEMPLATE,
} from './fxCsvImport'

const HEAD = 'date,currency,accountType,amount,bookRate,annualInterestRate,maturityDate'

describe('FX CSV import', () => {
  it('금액 0인 재고는 제외한다', () => {
    const r = parseInventoryCsv('date,currency,accountType,amount,bookRate,annualInterestRate,maturityDate\n2026-01-01,USD,demand_deposit,0,1400,0,\n2026-01-02,USD,demand_deposit,100,1450,0,')
    expect(r.rows).toHaveLength(1); expect(r.skipped).toBe(1); expect(r.errors).toHaveLength(0)
  })
  it('정기예금은 유효한 만기일을 요구한다', () => {
    const r = parseInventoryCsv('date,currency,accountType,amount,bookRate,annualInterestRate,maturityDate\n2026-01-02,USD,term_deposit,100,1450,3.5,')
    expect(r.rows).toHaveLength(0); expect(r.errors).toHaveLength(1)
  })
  it('매각 실현손익을 계산한다', () => {
    const r = parseSalesCsv('date,currency,amount,acquisitionRate,saleRate\n2026-01-01,USD,100,1400,1450')
    expect(r.rows[0].realizedPnlKRW).toBe(5000)
  })

  // ─── 2026-08-12 실데이터에서 발견된 결함 회귀 방지 ───────────────────

  it('mmda 를 허용한다 (실제 개시재고에 6건 존재)', () => {
    const r = parseInventoryCsv(`${HEAD}\n2026-01-08,USD,mmda,1222022.29,1448.3,3,`)
    expect(r.errors).toHaveLength(0)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].accountType).toBe('mmda')
    // mmda 는 이자율은 보존하되 만기는 없다
    expect(r.rows[0].annualInterestRate).toBe(3)
    expect(r.rows[0].maturityDate).toBeNull()
  })

  it('알 수 없는 계좌유형은 거부한다', () => {
    const r = parseInventoryCsv(`${HEAD}\n2026-01-08,USD,savings,100,1400,0,`)
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
  })

  it("'#' 주석 줄을 건너뛰고 오류 행번호는 원본 기준을 유지한다", () => {
    // 2행이 주석이므로 잘못된 데이터는 원본 3행이다
    const r = parseInventoryCsv(`${HEAD}\n# 안내 주석\n2026-01-08,XXX,mmda,100,1400,0,`)
    expect(r.rows).toHaveLength(0)
    expect(r.errors[0]).toContain('3행')
  })

  it('표준 양식은 그대로 다시 파싱된다 (주석 포함)', () => {
    const r = parseInventoryCsv(INVENTORY_CSV_TEMPLATE)
    expect(r.errors).toHaveLength(0)
    expect(r.rows.map(x => x.accountType).sort())
      .toEqual(['demand_deposit', 'mmda', 'term_deposit'])
  })

  it('중복 판정 키는 5필드 — 이자율·만기가 달라도 같은 로트로 본다', () => {
    // 교정 대상(이자율/만기가 비어 있던 기존 로트)을 새 CSV 행과 매칭해야 하므로
    // 이 두 필드가 키에 들어가면 중복 판정이 깨져 60건이 통째로 중복 삽입된다.
    const base = { date: '2026-03-11', currency: 'USD',
      accountType: 'term_deposit' as const, amount: 1000000, bookRate: 1472.8 }
    expect(inventoryMatchKey(base)).toBe('2026-03-11|USD|term_deposit|1000000|1472.8')
    expect(inventoryMatchKey({ ...base })).toBe(inventoryMatchKey(base))
  })
})
