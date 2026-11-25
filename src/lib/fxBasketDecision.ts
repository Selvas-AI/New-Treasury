/**
 * fxBasketDecision — 외화 바구니 판정 SSOT (2026-11-25 전수조사 F-05 · F-06 · F-20)
 *
 * ⭐ 왜 별도 모듈인가
 *   외화 비중은 바구니(전 통화 합계) 하나뿐이므로 목표·조치도 하나여야 한다(2026-11-04).
 *   그 판정이 FX 리짐 전략 **페이지 안에만** 있어서, 다른 소비처는 통화별 판정을 받았다.
 *     · 판정 스냅샷 → 대시보드·자금일보 경보가 통화별로 떠 같은 의무를 두 번 셌다
 *     · 자금정책 ① 리짐 이행 현황이 실무 화면과 다른 목표를 보여줬다
 *     · 대표 통화 판정에 **현재 탭 통화의** 결제버퍼·장부환율이 섞였다(F-06)
 *   → 판정 전 과정을 이 순수 함수 하나로 모은다.
 *
 * ⚠ 이 함수의 입력에는 **"지금 보고 있는 통화 탭"이 없다.** 그래서 탭과 무관하다는 것이
 *   타입으로 보장된다. 통화 탭은 분석 화면(차트·근거·앵커)만 바꾼다.
 *
 * ⚠ 판정 경로는 여전히 evaluateRegime 하나다. 여기서는 입력(바구니 ctx)을 만들고
 *   결과를 묶을 뿐, 목표비중을 다시 계산하지 않는다.
 */
import {
  evaluateRegime, protocolFromParams,
  type FxRegimeSignal, type RegimeSeriesPoint, type TreasuryContext,
} from './fxRegime'
import { buildVerdict, type Verdict } from './fxVerdict'
import { allocateAcrossBasket, type FxAllocationRow, type FxBandExceedResult } from './fxBandExceed'
import { lossBudget, bepStats, type LossBudget } from './fxPnl'
import { bizDaysBetween } from './bizDay'
import type { FxCode } from './treasuryCalc'

/** 판정에 필요한 최소 표본 (useFxRegime.MIN_SERIES_LENGTH 와 같은 값) */
const MIN_SERIES = 30

/** 대표 통화를 바꾸려면 새 1위가 기존 대표보다 이만큼(구성비 %p) 앞서야 한다 */
export const LEAD_SWITCH_MARGIN_PCT = 5

export type BasketRows = Record<string, { nativeAmount: number; krwAmount: number }>

/**
 * 바구니 대표 통화 — 원화 환산 보유 1위. 직전 대표와 차이가 작으면 유지한다(F-20).
 *
 * ⚠ 매번 1위를 새로 고르면, 구성비가 비슷한 두 통화 사이에서 **환율 변동만으로**
 *   대표가 바뀌고 바구니 결론이 계단식으로 뒤집힌다.
 */
export function pickLeadCurrency(
  basket: BasketRows,
  prevLead: string | null,
  marginPct = LEAD_SWITCH_MARGIN_PCT,
): { code: FxCode; sharePct: number | null } {
  const total = Object.values(basket).reduce((s, v) => s + Math.max(0, v.krwAmount), 0)
  const rows = Object.entries(basket)
    .filter(([, v]) => v.krwAmount > 0)
    .sort((a, b) => b[1].krwAmount - a[1].krwAmount)
  if (!rows.length || total <= 0) return { code: (prevLead ?? 'USD') as FxCode, sharePct: null }

  const share = (code: string) => ((basket[code]?.krwAmount ?? 0) / total) * 100
  const top = rows[0][0]
  if (prevLead && prevLead !== top && (basket[prevLead]?.krwAmount ?? 0) > 0
      && share(top) - share(prevLead) < marginPct) {
    return { code: prevLead as FxCode, sharePct: share(prevLead) }
  }
  return { code: top as FxCode, sharePct: share(top) }
}

export interface BasketCurrencyInput {
  /** 정규화된 환율 시계열(원/1외화) — useFxHistory().series */
  series: RegimeSeriesPoint[]
  /** FIFO 원장 요약. 로트가 없으면 null */
  lots: { totalAmount: number; availableAmount: number; bookRate: number | null } | null
  /** 향후 결제 버퍼 (외화 원금) */
  payableFx: number
}

export interface BasketDecisionInput {
  basket: BasketRows
  /** 정책 비중 분모 (usePolicyDashboard.fxPolicyDenominator) */
  denominatorKRW: number
  /** 외화 바구니 원화 합계 (usePolicyDashboard.fxPortfolioHoldings) */
  holdingsKRW: number
  get: (key: string) => number | null
  currencies: Record<string, BasketCurrencyInput>
  /** 시계열이 없는 통화의 버퍼 환산용 시장환율 (원/1외화) */
  marketRates: Partial<Record<string, number>>
  bandExceed: FxBandExceedResult
  quarterLossCapKRW: number
  realizedLossKRW: number
  /** 직전 대표 통화 (스냅샷) — 대표 전환 히스테리시스 */
  prevLead: string | null
  today: string
  /** 시뮬레이션 모드에서만 — 실험값으로 ctx 를 덮어쓴다 */
  ctxOverride?: Partial<TreasuryContext> | null
}

export interface BasketBudget {
  rate: number
  requestedFx: number
  costRate: number
  holdFx: number
  budget: LossBudget
}

export interface BasketDecision {
  leadCode: FxCode
  leadShare: number | null
  signal: FxRegimeSignal | null
  ctx: TreasuryContext
  /** 판정 기준일이 오늘보다 뒤처진 영업일 수 */
  staleDays: number | null
  budget: BasketBudget | null
  verdict: Verdict | null
  /** 조치 카드 금액(verdict.orderKRW)의 통화별 배분 */
  allocation: FxAllocationRow[]
  /**
   * **리짐 몫만**의 집행 가능 원화 — 매각 지시 등록·스냅샷에 쓴다.
   * ⚠ verdict.orderKRW 는 밴드 복귀 의무가 더 크면 그 금액이 된다. 밴드 복귀분은
   *   한도초과 지시(threshold)로 따로 발의하므로, 리짐 지시에 넣으면 같은 의무를 두 번 등록한다.
   */
  regimeExecKRW: number
  regimeAllocation: FxAllocationRow[]
  /** 스냅샷 기록용 — 리짐 권고 총액(예산 적용 전) */
  regimeSuggestKRW: number
}

/** 마지막 시계열 값 → 시장환율 → 바구니 내재환율 순으로 원/1외화 환율을 고른다 */
function rateOf(code: string, input: BasketDecisionInput): number {
  const s = input.currencies[code]?.series
  const last = s && s.length ? s[s.length - 1].rate : 0
  if (last > 0) return last
  const m = input.marketRates[code] ?? 0
  if (m > 0) return m
  const b = input.basket[code]
  return b && b.nativeAmount > 0 ? b.krwAmount / b.nativeAmount : 0
}

const pctToRatio = (v: number | null) =>
  v == null || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v / 100))

export function buildBasketDecision(input: BasketDecisionInput): BasketDecision {
  const { code: leadCode, sharePct: leadShare } = pickLeadCurrency(input.basket, input.prevLead)

  // ── 바구니 ctx (F-06) ── 결제버퍼는 **모든 통화의 합계**다.
  //   과거엔 현재 탭 통화 하나의 버퍼만 들어가 탭에 따라 하한이 달라졌다.
  const fxPayableKRW = Object.entries(input.currencies)
    .reduce((sum, [code, c]) => sum + Math.max(0, c.payableFx) * rateOf(code, input), 0)
  const minR = pctToRatio(input.get('fx_target_min'))
  const maxR = pctToRatio(input.get('fx_target_max'))
  const bandValid = minR == null || maxR == null || minR <= maxR
  const lead = input.currencies[leadCode]
  const leadBook = lead?.lots?.bookRate ?? null

  const ctx: TreasuryContext = {
    totalFundKRW: input.denominatorKRW,
    fxHoldingKRW: input.holdingsKRW,
    fxPayableKRW,
    policyMaxRatio: bandValid ? maxR : null,
    policyMinRatio: bandValid ? minR : null,
    maxExposureKRW: null,
    // 엔진 내부의 예상손익·원가이하 판정은 보조 정보다 — 대표 통화 장부환율을 쓴다
    avgAcquisitionRate: leadBook != null && leadBook > 0 ? leadBook : null,
    daysSinceLastConvert: null,
    ...(input.ctxOverride ?? {}),
  }

  const series = lead?.series ?? []
  const signal = series.length >= MIN_SERIES
    ? evaluateRegime(series, ctx, protocolFromParams(input.get, leadCode), leadCode)
    : null

  const empty = (s: FxRegimeSignal | null): BasketDecision => ({
    leadCode, leadShare, signal: s, ctx, staleDays: null, budget: null, verdict: null,
    allocation: [], regimeExecKRW: 0, regimeAllocation: [], regimeSuggestKRW: 0,
  })
  if (!signal) return empty(null)

  const staleDays = signal.asOf >= input.today ? 0 : bizDaysBetween(signal.asOf, input.today)

  // ── 예산 — 대표 통화 기준(F-15·F-16 은 묶음 D 에서 통화별로 확장) ──
  const rate = signal.indicators.close
  const holdFx = lead?.lots && lead.lots.totalAmount > 0
    ? lead.lots.totalAmount : (input.basket[leadCode]?.nativeAmount ?? 0)
  const avail = lead?.lots && lead.lots.totalAmount > 0 ? lead.lots.availableAmount : holdFx
  const costRate = leadBook ?? 0
  const regimeSuggestKRW = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
    ? -signal.decision.suggestedTradeKRW : 0
  const requestedFx = rate > 0 ? Math.min(regimeSuggestKRW / rate, avail) : 0
  const budget: BasketBudget = {
    rate, requestedFx, costRate, holdFx,
    budget: lossBudget(input.quarterLossCapKRW, input.realizedLossKRW, requestedFx, holdFx, costRate, rate),
  }

  const bep = costRate > 0 ? bepStats(series, costRate, 750) : null
  const band = input.bandExceed
  const verdict = buildVerdict({
    signal, currency: leadCode,
    holdingFx: holdFx, avgCostRate: costRate,
    allowedFx: budget.budget.allowedFx, requestedFx,
    pctDaysAboveBep: bep?.pctDaysAbove ?? null,
    bandExcessKRW: band.over ? band.excessKRW : 0,
    bandMaxPct: band.max,
    asOfStaleDays: staleDays,
    rebalanceBandPct: protocolFromParams(input.get, leadCode).rebalanceBandPct,
  })

  const allocation = verdict.orderKRW ? allocateAcrossBasket(verdict.orderKRW, input.basket) : []
  // 판정 이력이 오래됐으면(blocked) 리짐 몫은 0 — 오래된 데이터로 지시를 만들지 않는다
  const regimeExecKRW = verdict.kind === 'blocked' ? 0 : budget.budget.allowedFx * rate
  const regimeAllocation = regimeExecKRW > 0 ? allocateAcrossBasket(regimeExecKRW, input.basket) : []

  return {
    leadCode, leadShare, signal, ctx, staleDays, budget, verdict,
    allocation, regimeExecKRW, regimeAllocation,
    regimeSuggestKRW: verdict.kind === 'blocked' ? 0 : regimeSuggestKRW,
  }
}
