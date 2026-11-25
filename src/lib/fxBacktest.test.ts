import { describe, it, expect } from 'vitest'
import { runBacktest, type BacktestInput } from './fxBacktest'
import { DEFAULT_PROTOCOL } from './fxRegime'
import type { FxLot } from './fxLots'

// 300영업일 완만한 상승 + 잔물결 (판정이 나오도록)
function series(base = 1400, days = 300, drift = 0.0003) {
  const out: { date: string; rate: number }[] = []
  const d = new Date('2025-01-02T00:00:00Z')
  for (let i = 0; i < days; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    out.push({ date: d.toISOString().slice(0, 10), rate: base * (1 + drift * i) + Math.sin(i / 3) * base * 0.002 })
  }
  return out
}

const S = series()

function input(over: Partial<BacktestInput> = {}): BacktestInput {
  return {
    series: S,
    startDate: S[120].date,
    initialTotalKRW: 100_000_000_000,
    initialFxHolding: 20_000_000,          // 약 28%
    monthlyInflowFx: 300_000,
    fxPayableFx: 0,
    policyMinRatio: null,
    policyMaxRatio: null,
    protocol: DEFAULT_PROTOCOL,
    ...over,
  }
}

describe('runBacktest — 실전 리밸런싱 밴드 (F-07)', () => {
  it('밴드가 아주 넓으면 실전 규칙에선 팔지 않는다 — 초과분은 "밴드로 보류"로 집계', () => {
    const wide = { ...DEFAULT_PROTOCOL, rebalanceBandPct: 0.9, forceConvertDays: 9999 }
    const r = runBacktest(input({ protocol: wide }))
    expect(r.tradeCount).toBe(0)
  })

  it('같은 조건에서 밴드를 무시하면(과거 방식) 점검일마다 판다', () => {
    const wide = { ...DEFAULT_PROTOCOL, rebalanceBandPct: 0.9, forceConvertDays: 9999 }
    const gated = runBacktest(input({ protocol: wide }))
    const ignored = runBacktest(input({ protocol: wide, ignoreRebalanceBand: true }))
    expect(ignored.tradeCount).toBeGreaterThan(0)
    expect(gated.heldByBandChecks).toBeGreaterThan(0)
  })

  it('밴드가 좁을수록 거래가 많거나 같다 (단조성)', () => {
    const counts = [0.01, 0.03, 0.05].map(b =>
      runBacktest(input({ protocol: { ...DEFAULT_PROTOCOL, rebalanceBandPct: b } })).tradeCount)
    expect(counts[0]).toBeGreaterThanOrEqual(counts[2])
  })
})

describe('runBacktest — 분기 손실 한도 (F-07 · F-08)', () => {
  const highCost: FxLot[] = [{
    id: 'old', company: 'c', currency: 'USD', acquiredDate: '2024-01-01',
    originalAmount: 20_000_000, remainingAmount: 20_000_000, acqRate: 1700,
    accountType: 'demand_deposit', annualInterestRate: 0, sourceType: 'opening',
  }]
  const sellAll = { ...DEFAULT_PROTOCOL, rebalanceBandPct: 0 }
  const base = input({ protocol: sellAll, initialLots: highCost, ignoreRebalanceBand: true })

  it('한도가 없으면 고원가 로트를 팔아 손실이 크게 난다', () => {
    const r = runBacktest(base)
    expect(r.cappedByLossTrades).toBe(0)
    expect(r.realizedLossKRW).toBeLessThan(0)   // 손실은 음수로 집계된다
  })

  it('한도를 두면 분기 손실이 한도를 넘지 않도록 덜 판다', () => {
    const cap = 50_000_000
    const free = runBacktest(base)
    const capped = runBacktest({ ...base, quarterLossCapKRW: cap })
    const lossByQuarter = new Map<string, number>()
    for (const t of capped.trades) {
      const q = `${t.date.slice(0, 4)}q${Math.floor((Number(t.date.slice(5, 7)) - 1) / 3) + 1}`
      lossByQuarter.set(q, (lossByQuarter.get(q) ?? 0) + Math.max(0, -(t.realizedPnlKRW ?? 0)))
    }
    expect(-free.realizedLossKRW).toBeGreaterThan(cap)
    expect(capped.cappedByLossTrades).toBeGreaterThan(0)
    for (const v of lossByQuarter.values()) expect(v).toBeLessThanOrEqual(cap * 1.01)
  })
})
