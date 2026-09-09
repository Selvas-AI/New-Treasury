import { describe, it, expect } from 'vitest'
import {
  buildBridge, classifyItem, scopeBalanceOn, isMaterialFxEffect,
  type FlowItemInput,
} from './flowBridge'
import type { DailyRecord, InvestmentRecord } from '../types'

const toKRW = (n: number, c: string) => (c === 'USD' ? n * 1400 : n)

function inv(p: Partial<InvestmentRecord>): InvestmentRecord {
  return {
    id: 'i1', company: '메디아나', bank: '국민은행', product: '정기예금',
    amount: 1_000_000_000, currency: 'KRW', rate: 3, start: '2026-01-01',
    maturity: '2027-01-01', available: '가용', active: true,
    ...p,
  } as InvestmentRecord
}

function daily(p: Partial<DailyRecord>): DailyRecord {
  return {
    id: 'd1', company: '메디아나', date: '2026-01-01', writer: 'x',
    krw_demand: 0, krw_govt: 0, krw_mmda: 0,
    fx_usd: 0, fx_eur: 0, fx_jpy: 0, fx_gbp: 0, fx_cny: 0, fx_krw: 0, memo: '',
    ...p,
  } as DailyRecord
}

function item(p: Partial<FlowItemInput>): FlowItemInput {
  return {
    id: 'x', date: '2026-01-05', direction: 'in', category: 'ar_collection',
    amountKrw: 100, currency: 'KRW', ...p,
  }
}

describe('classifyItem — 경계 판정', () => {
  const investById = new Map<string, InvestmentRecord>([
    ['dep', inv({ id: 'dep', product: '정기예금' })],
    ['bond', inv({ id: 'bond', product: '국채' })],
  ])

  it('영업·재무 카테고리는 연동 정보 없이도 확정된다', () => {
    expect(classifyItem(item({ category: 'ar_collection' }), investById)).toBe('operating')
    expect(classifyItem(item({ category: 'loan_drawdown' }), investById)).toBe('financing')
    expect(classifyItem(item({ category: 'loan_repayment' }), investById)).toBe('financing')
  })

  it('운용자금 집행은 내부이동 — 합계가 줄지 않는다', () => {
    const it0 = item({ category: 'invest_execute', direction: 'out', linkedType: 'investment', linkedId: 'dep' })
    expect(classifyItem(it0, investById)).toBe('internal')
  })

  it('국채·지분은 범위 밖 자산으로 실제 유출이다', () => {
    expect(classifyItem(item({ category: 'invest_execute', linkedType: 'investment', linkedId: 'bond' }), investById)).toBe('external')
    expect(classifyItem(item({ category: 'invest_execute', linkedType: 'equity' }), investById)).toBe('external')
  })

  it('연동 정보가 없으면 추측하지 않고 분류 불가로 남긴다', () => {
    expect(classifyItem(item({ category: 'invest_execute' }), investById)).toBe('unknown')
    expect(classifyItem(item({ category: 'invest_return', linkedType: 'investment', linkedId: '없는id' }), investById)).toBe('unknown')
  })

  it('평가손익 자동기재는 현금 이동이 아니므로 분해에서 제외한다', () => {
    expect(classifyItem(item({ category: 'invest_eval_in' }), investById)).toBe('excluded')
    expect(classifyItem(item({ category: 'invest_eval_out' }), investById)).toBe('excluded')
  })
})

describe('scopeBalanceOn — 시점 잔액', () => {
  const invests = [
    inv({ id: 'a', amount: 1_000_000_000, start: '2026-01-01', closed_date: null }),
    inv({ id: 'b', amount: 500_000_000, start: '2026-01-01', closed_date: '2026-02-01', active: false }),
    inv({ id: 'c', product: '국채', amount: 900_000_000 }),
    inv({ id: 'd', amount: 700_000_000, available: '불가용' }),
  ] as InvestmentRecord[]

  it('국채·불가용은 제외한다', () => {
    const b = scopeBalanceOn(daily({}), invests, '2026-01-15', toKRW)
    expect(b.investKrw).toBe(1_500_000_000)   // a + b (b는 아직 열려 있음)
  })

  it('상환된 건은 그 이후 날짜에서 빠진다 — 과거로 소급되지 않는다', () => {
    const b = scopeBalanceOn(daily({}), invests, '2026-03-01', toKRW)
    expect(b.investKrw).toBe(1_000_000_000)   // a 만
  })

  // ⚠ 운전자금 외화는 daily.fx_krw 에 **그날 환율로 환산된 값**이 이미 저장돼 있다.
  //   오늘 환율로 다시 환산하지 않는다(대시보드와 같은 SSOT — opCashKRW).
  it('운전자금은 저장된 원화환산액(fx_krw)을 그대로 더한다', () => {
    const b = scopeBalanceOn(daily({ krw_demand: 100, fx_usd: 1, fx_krw: 1400 }), [], '2026-01-15', toKRW)
    expect(b.operatingKrw).toBe(1500)
  })
})

describe('buildBridge', () => {
  const investById = new Map<string, InvestmentRecord>([['dep', inv({ id: 'dep' })]])
  const bd = (avail: number, bond = 0, locked = 0) =>
    ({ availKrw: avail, bondKrw: bond, lockedKrw: locked, allKrw: avail + bond + locked })
  const base = {
    from: '2026-01-01', to: '2026-01-31',
    opening: { operatingKrw: 1000, investKrw: 0, total: 1000 },
    closing: { operatingKrw: 1200, investKrw: 0, total: 1200 },
    investById,
    openingBreakdown: bd(0),
    closingBreakdown: bd(0),
  }

  it('경계를 넘은 항목만 순증감에 반영한다', () => {
    const b = buildBridge({
      ...base,
      items: [
        item({ direction: 'in',  category: 'ar_collection', amountKrw: 300 }),
        item({ direction: 'out', category: 'ap_payment',    amountKrw: 100 }),
      ],
    })
    expect(b.observed).toBe(200)
    expect(b.explained).toBe(200)
    expect(b.unexplained).toBe(0)
    expect(b.coverage).toBe(1)
  })

  it('내부이동은 두 레인에 각각 잡혀 합계가 0이 된다', () => {
    const b = buildBridge({
      ...base,
      closing: { operatingKrw: 200, investKrw: 800, total: 1000 },   // 합계 불변
      closingBreakdown: bd(800),
      items: [
        item({ direction: 'out', category: 'invest_execute', amountKrw: 800,
               linkedType: 'investment', linkedId: 'dep' }),
      ],
      investFlowNet: 800,                // 레코드에서 도출한 운용 개시
    })
    expect(b.observed).toBe(0)
    // 운전 레인: 800 나감 / 운용 레인: 800 들어옴 → 합계 0
    expect(b.lanes.opDelta).toBe(-800)
    expect(b.lanes.opExplained).toBe(-800)
    expect(b.lanes.opUnexplained).toBe(0)
    expect(b.lanes.investDelta).toBe(800)
    expect(b.lanes.investExplained).toBe(800)
    expect(b.explained).toBe(0)
    expect(b.unexplained).toBe(0)
  })

  // ⭐ 실사고 재발 방지 — 운용자금을 운용자금 메뉴에서 직접 등록하면 자금일보 항목이
  //   하나도 없다. 그때 증감을 자금일보로만 설명하려 하면 전부 미설명으로 빠진다
  //   (2026-09-08 메디아나 +130억이 미설명 109억으로 나온 사례).
  it('자금일보 항목이 없어도 운용 증감은 레코드로 설명된다', () => {
    const b = buildBridge({
      ...base,
      closing: { operatingKrw: 1000, investKrw: 130, total: 1130 },
      closingBreakdown: bd(130),
      items: [],
      investFlowNet: 130,
    })
    expect(b.observed).toBe(130)
    expect(b.explained).toBe(130)
    expect(b.unexplained).toBe(0)
    expect(b.coverage).toBe(1)
  })

  it('레코드로 설명되지 않는 운용 증감은 조정으로 남긴다', () => {
    const b = buildBridge({
      ...base,
      closing: { operatingKrw: 1000, investKrw: 130, total: 1130 },
      closingBreakdown: bd(130),
      items: [],
      investFlowNet: 100,               // 개시는 100뿐인데 잔액은 130 늘었다
    })
    expect(b.lanes.investAdjust).toBe(30)
    expect(b.unexplained).toBe(30)
  })

  it('설명되지 않는 증감은 미설명 차액으로 남긴다', () => {
    const b = buildBridge({ ...base, items: [] })
    expect(b.observed).toBe(200)
    expect(b.explained).toBe(0)
    expect(b.unexplained).toBe(200)
    expect(b.coverage).toBe(0)
  })

  it('분류 불가 항목을 설명에 넣지 않는다 — 틀린 값을 확정하지 않는다', () => {
    const b = buildBridge({
      ...base,
      items: [item({ direction: 'out', category: 'invest_execute', amountKrw: 500 })],
    })
    expect(b.groups.unknown.outKrw).toBe(500)
    expect(b.explained).toBe(0)
    expect(b.unexplained).toBe(200)
  })

  // 국채는 시가가 움직이면 현금 이동 없이 총액이 변한다 — 별도 레인으로 잡아야
  // "왜 줄었나"에 엉뚱한 답이 나오지 않는다.
  it('국채 평가 변동은 별도 레인으로 잡고 미설명으로 남기지 않는다', () => {
    const b = buildBridge({
      ...base,
      opening: { operatingKrw: 1000, investKrw: 0, total: 1000 },
      closing: { operatingKrw: 1000, investKrw: 0, total: 1000 },
      openingBreakdown: bd(0, 500),
      closingBreakdown: bd(0, 480),     // 국채 평가 −20
      items: [],
    })
    expect(b.observed).toBe(-20)
    expect(b.lanes.bondDelta).toBe(-20)
    expect(b.explained).toBe(-20)
    expect(b.unexplained).toBe(0)
  })

  it('카테고리는 금액 순으로 정렬한다', () => {
    const b = buildBridge({
      ...base,
      items: [
        item({ direction: 'in',  category: 'ar_collection', amountKrw: 100 }),
        item({ direction: 'out', category: 'ap_payment',    amountKrw: 900 }),
      ],
    })
    expect(b.categories[0].category).toBe('ap_payment')
  })
})

describe('환율효과 임계값', () => {
  it('원화 환산 1천만원 미만은 무시한다', () => {
    expect(isMaterialFxEffect(9_999_999)).toBe(false)
    expect(isMaterialFxEffect(-10_000_000)).toBe(true)
  })
})
