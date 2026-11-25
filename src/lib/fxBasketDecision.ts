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
 *   결과를 묶을 뿐, 국면·목표 판정 로직을 따로 두지 않는다.
 *
 * ⭐ 바구니 목표 = 통화별 목표의 보유 비중 가중평균 (2026-11-25 결정 D4)
 *   과거엔 대표 통화(보유 1위) 판정 하나가 바구니 전체 목표를 정했다 — EUR·JPY 가 강세든
 *   약세든 USD 국면대로 같은 비율로 팔았다. 이제
 *     · 통화마다 자기 시계열·자기 앵커로 evaluateRegime 을 돌려 목표 t_i 를 받는다(같은 바구니 ctx)
 *     · 바구니 목표 t* = Σ w_i · t_i  (w_i = 바구니 안 원화 구성비)
 *     · 통화별 매도 = h_i × (1 − t_i / c)  (c = 현재 비중) — 합계가 정확히 (c − t*)·T 가 된다.
 *       자기 목표가 높은(유리한 국면) 통화는 덜 팔고, 낮은 통화는 더 판다.
 *       t_i > c 인 통화는 0(매수하지 않음)으로 두고 나머지를 비율대로 늘려 합계를 맞춘다.
 *   시계열이 부족한 통화는 대표 통화 목표를 대신 쓴다(화면에 "대표 통화 목표 적용"으로 표시).
 *   앵커가 없는 통화는 수준 축 없이 추세만으로 판정된다(protocolFromParams 규칙).
 *   리밸런싱 기준(3%p)·대표 통화(문구·차트)는 그대로다.
 */
import {
  evaluateRegime, protocolFromParams,
  type FxRegimeSignal, type RegimeSeriesPoint, type TreasuryContext,
} from './fxRegime'
import { buildVerdict, type Verdict } from './fxVerdict'
import { allocateAcrossBasket, type FxAllocationRow, type FxBandExceedResult } from './fxBandExceed'
import { bepStats } from './fxPnl'
import { availableAmount, previewFifoConsumption, unrealizedPnlKRW, type FxLot } from './fxLots'
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
  lots: { totalAmount: number; availableAmount: number; bookRate: number | null
          /** 지금 팔 수 있는 로트의 가중평균 장부환율 (F-18) */
          availableBookRate?: number | null } | null
  /** FIFO 로트 원본 — 바구니 매도의 통화별 실현손익 미리보기(F-15)·손실 한도(F-08)에 쓴다 */
  fifoLots?: FxLot[]
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
  /** FIFO 계좌유형 소진 우선순위 (parseAccountPriority) — 서버 RPC 와 같은 순서로 미리본다 */
  accountPriority?: Record<string, number>
  today: string
  /** 시뮬레이션 모드에서만 — 실험값으로 ctx 를 덮어쓴다 */
  ctxOverride?: Partial<TreasuryContext> | null
}

export interface BasketBudget {
  /** 대표 통화 종가 — verdict 의 수량 환산 기준 */
  rate: number
  /** 리짐 권고를 **통화별 가용재고 한도 안에서** 팔 수 있는 원화 (F-16) */
  requestedKRW: number
  /** 분기 손실 한도까지 반영한 집행 가능 원화 (F-08 · FIFO 기준) */
  allowedKRW: number
  /** verdict 호환용 — 대표 통화 단위로 환산한 값 */
  requestedFx: number
  allowedFx: number
  costRate: number
  holdFx: number
  capKRW: number
  usedKRW: number
  remainingKRW: number
  /** 손실 한도 때문에 줄었는가 */
  cappedByLoss: boolean
  /** 손실 한도를 지키며 집행한 비율 (0~1) */
  scale: number
}

/** 통화별 목표와 매도 몫 (D4) */
export interface BasketCurrencyTarget {
  code: FxCode
  /** 바구니 안 원화 구성비(%) */
  sharePct: number
  holdingKRW: number
  /** 이 통화 자체 판정. 시계열 부족이면 null */
  signal: FxRegimeSignal | null
  /** 이 통화의 목표 비중(제약 적용 후, 0~1) */
  targetRatio: number
  /** own = 자기 판정, lead = 시계열 부족으로 대표 통화 목표를 대신 씀 */
  source: 'own' | 'lead'
  /** 앵커 설정 여부 — 없으면 추세만 반영 */
  anchorSet: boolean
  /** 리짐 권고 총액 중 이 통화 몫(원, 예산 적용 전) */
  sellKRW: number
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
  /** 통화별 목표·매도 몫 (D4). 판정이 없으면 빈 배열 */
  currencyTargets: BasketCurrencyTarget[]
  /** 대표 통화 단독 목표 — 가중평균과 비교 표시용 */
  leadTargetRatio: number | null
  /**
   * 참고 — 지금 보유 외화의 평가손익(원장 로트 × 최근 환율). 분기 손실 한도에는 넣지 않는다(D3).
   * 원장 로트가 없는 통화는 빠진다.
   */
  valuation: { code: string; rate: number; pnlKRW: number }[]
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
    avgAcquisitionRate: (lead?.lots?.availableBookRate ?? leadBook) || null,
    daysSinceLastConvert: null,
    ...(input.ctxOverride ?? {}),
  }

  const valuation = Object.entries(input.currencies)
    .filter(([, c]) => (c.fifoLots?.length ?? 0) > 0)
    .map(([code, c]) => { const r = rateOf(code, input); return { code, rate: r, pnlKRW: r > 0 ? unrealizedPnlKRW(c.fifoLots!, r) : 0 } })
    .filter(v => v.rate > 0)

  const series = lead?.series ?? []
  const leadProtocol = protocolFromParams(input.get, leadCode)
  const leadSignal = series.length >= MIN_SERIES
    ? evaluateRegime(series, ctx, leadProtocol, leadCode)
    : null

  const empty = (s: FxRegimeSignal | null): BasketDecision => ({
    leadCode, leadShare, signal: s, ctx, staleDays: null, budget: null, verdict: null,
    allocation: [], regimeExecKRW: 0, regimeAllocation: [], regimeSuggestKRW: 0,
    currencyTargets: [], leadTargetRatio: s?.decision.appliedTargetRatio ?? null, valuation,
  })
  if (!leadSignal) return empty(null)

  // ── 통화별 목표 → 바구니 가중평균 목표 (D4) ──
  const { targets: currencyTargets, signal } = weightBasketTargets(input, ctx, leadCode, leadSignal, leadProtocol.rebalanceBandPct)

  const staleDays = signal.asOf >= input.today ? 0 : bizDaysBetween(signal.asOf, input.today)

  // ── 예산 (F-08 · F-15 · F-16 · F-18) ──
  //   바구니 매도는 배분표대로 **여러 통화에서** 나간다. 그래서
  //   · 매도 가능량은 통화마다 그 통화의 가용재고로 자른다(F-16) — 대표 통화 재고 하나로 자르면
  //     정기예금 잠금 때문에 EUR 재고로 충분한데도 권고가 잘렸다. 부족분은 다른 통화로 넘기지 않는다.
  //   · 실현손익·손실은 통화별 FIFO 미리보기로 낸다(F-15) — 대표 통화 평균원가 하나로 내면
  //     오래된 고가 로트부터 나가는 실제 손실과 달라 분기 한도를 넘겨 집행될 수 있었다(F-08).
  const rate = signal.indicators.close
  const holdFx = lead?.lots && lead.lots.totalAmount > 0
    ? lead.lots.totalAmount : (input.basket[leadCode]?.nativeAmount ?? 0)
  const costRate = lead?.lots?.availableBookRate ?? leadBook ?? 0
  const regimeSuggestKRW = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
    ? -signal.decision.suggestedTradeKRW : 0

  // 리짐 매도는 통화별 몫(D4)대로, 몫이 없으면(매도 권고 없음) 구성비대로 나눈다
  const regimeWeights = currencyTargets.filter(t => t.sellKRW > 0)
  const regimeWeightSum = regimeWeights.reduce((t, r) => t + r.sellKRW, 0)
  const splitKRW = (totalKRW: number): FxAllocationRow[] => {
    if (regimeWeightSum <= 0) return allocateAcrossBasket(totalKRW, input.basket)
    return regimeWeights.map(w => {
      const b = input.basket[w.code]
      const r = b && b.nativeAmount > 0 ? b.krwAmount / b.nativeAmount : 0
      const krwAmount = totalKRW * (w.sellKRW / regimeWeightSum)
      return { code: w.code, sharePct: w.sharePct, krwAmount, nativeAmount: r > 0 ? krwAmount / r : null }
    }).sort((a, b) => b.krwAmount - a.krwAmount)
  }
  const saleRows = (totalKRW: number) => splitKRW(totalKRW)
    .filter(a => a.nativeAmount != null && a.nativeAmount > 0)
    .map(a => {
      const lots = input.currencies[a.code]?.fifoLots ?? []
      const avail = lots.length ? availableAmount(lots, input.today) : (input.basket[a.code]?.nativeAmount ?? 0)
      return { code: a.code, sharePct: a.sharePct, rate: a.krwAmount / (a.nativeAmount as number),
               want: a.nativeAmount as number, got: Math.min(a.nativeAmount as number, Math.max(0, avail)), lots }
    })
  /** 이 배분을 scale 만큼 팔 때의 FIFO 미리보기 — 실현손익(순)과 손실(총) */
  const preview = (rows: ReturnType<typeof saleRows>, scale: number) => {
    let net = 0; let loss = 0; let priced = false
    for (const r of rows) {
      if (!r.lots.length) continue
      priced = true
      for (const c of previewFifoConsumption(r.lots, r.got * scale, r.rate, input.today, input.accountPriority)) {
        net += c.realizedPnlKRW
        if (c.realizedPnlKRW < 0) loss -= c.realizedPnlKRW
      }
    }
    return { net, loss, priced }
  }

  const rows = saleRows(regimeSuggestKRW)
  const requestedKRW = rows.reduce((t, r) => t + r.got * r.rate, 0)
  const capKRW = Math.max(0, input.quarterLossCapKRW)
  const usedKRW = Math.max(0, input.realizedLossKRW)
  const remainingKRW = Math.max(0, capKRW - usedKRW)
  // 한도 미설정이면 제약 없음. 설정돼 있으면 손실(총)이 남은 한도를 넘지 않는 최대 비율을 찾는다
  // (FIFO 는 오래된 로트부터 나가 손실이 수량에 대해 단조 증가한다 → 이분 탐색).
  let scale = 1
  if (capKRW > 0 && requestedKRW > 0 && preview(rows, 1).loss > remainingKRW) {
    let lo = 0; let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (preview(rows, mid).loss <= remainingKRW) lo = mid; else hi = mid
    }
    scale = lo
  }
  const allowedKRW = requestedKRW * scale
  const budget: BasketBudget = {
    rate, requestedKRW, allowedKRW,
    requestedFx: rate > 0 ? requestedKRW / rate : 0,
    allowedFx: rate > 0 ? allowedKRW / rate : 0,
    costRate, holdFx, capKRW, usedKRW, remainingKRW,
    cappedByLoss: scale < 1 - 1e-9, scale,
  }
  /** 바구니 원화 금액을 팔 때의 예상 실현손익 — 조치 카드 문구(F-15) */
  const pnlForKRW = (krw: number): number | null => {
    const p = preview(saleRows(krw), 1)
    return p.priced ? p.net : null
  }

  const bep = costRate > 0 ? bepStats(series, costRate, 750) : null
  const band = input.bandExceed
  const verdict = buildVerdict({
    signal, currency: leadCode,
    holdingFx: holdFx, avgCostRate: costRate,
    allowedFx: budget.allowedFx, requestedFx: budget.requestedFx,
    pnlForKRW,
    pctDaysAboveBep: bep?.pctDaysAbove ?? null,
    bandExcessKRW: band.over ? band.excessKRW : 0,
    bandMaxPct: band.max,
    asOfStaleDays: staleDays,
    rebalanceBandPct: protocolFromParams(input.get, leadCode).rebalanceBandPct,
  })

  // 조치 금액의 통화별 배분 — 밴드 복귀 의무가 더 크면 그 지시(한도초과)와 같은 구성비 안분,
  // 리짐 권고가 결정한 금액이면 통화별 목표 몫(D4)대로 — 아래 매각 지시 등록 표와 같은 비율
  const bandDriven = band.over && band.excessKRW >= allowedKRW
  const allocation = verdict.orderKRW
    ? (bandDriven ? allocateAcrossBasket(verdict.orderKRW, input.basket) : splitKRW(verdict.orderKRW))
    : []
  // 판정 이력이 오래됐으면(blocked) 리짐 몫은 0 — 오래된 데이터로 지시를 만들지 않는다
  const regimeExecKRW = verdict.kind === 'blocked' ? 0 : allowedKRW
  // 리짐 몫의 통화별 배분 = 가용재고로 자른 수량 × 손실 한도 비율 — 등록 지시와 1:1 로 맞는다
  const regimeAllocation: FxAllocationRow[] = regimeExecKRW > 0
    ? rows.filter(r => r.got * scale > 0).map(r => ({
        code: r.code, sharePct: r.sharePct,
        krwAmount: r.got * scale * r.rate, nativeAmount: r.got * scale,
      }))
    : []

  return {
    leadCode, leadShare, signal, ctx, staleDays, budget, verdict,
    allocation, regimeExecKRW, regimeAllocation,
    regimeSuggestKRW: verdict.kind === 'blocked' ? 0 : regimeSuggestKRW,
    currencyTargets, leadTargetRatio: leadSignal.decision.appliedTargetRatio, valuation,
  }
}

/**
 * 통화별 판정 → 바구니 목표 가중평균 → 통화별 매도 몫 (D4).
 * 반환 signal 은 대표 통화 판정에 **바구니 목표를 덮어쓴** 것 — 문구·스냅샷·경보가 모두 같은 목표를 본다.
 */
export function weightBasketTargets(
  input: BasketDecisionInput,
  ctx: TreasuryContext,
  leadCode: FxCode,
  leadSignal: FxRegimeSignal,
  rebalanceBandPct: number,
): { targets: BasketCurrencyTarget[]; signal: FxRegimeSignal } {
  const rows = Object.entries(input.basket).filter(([, v]) => v.krwAmount > 0)
  const basketKRW = rows.reduce((t, [, v]) => t + v.krwAmount, 0)
  const leadTarget = leadSignal.decision.appliedTargetRatio
  if (basketKRW <= 0 || ctx.totalFundKRW <= 0) return { targets: [], signal: leadSignal }

  const targets: BasketCurrencyTarget[] = rows.map(([code, v]): BasketCurrencyTarget => {
    const s = input.currencies[code]?.series ?? []
    const own = code === leadCode
      ? leadSignal
      : s.length >= MIN_SERIES ? evaluateRegime(s, ctx, protocolFromParams(input.get, code), code) : null
    return {
      code: code as FxCode,
      sharePct: (v.krwAmount / basketKRW) * 100,
      holdingKRW: v.krwAmount,
      signal: own,
      targetRatio: own ? own.decision.appliedTargetRatio : leadTarget,
      source: own ? 'own' : 'lead',
      anchorSet: own?.level != null,
      sellKRW: 0,
    }
  }).sort((a, b) => b.holdingKRW - a.holdingKRW)

  const T = ctx.totalFundKRW
  const current = ctx.fxHoldingKRW / T
  const weighted = targets.reduce((t, r) => t + (r.sharePct / 100) * r.targetRatio, 0)
  const rawWeighted = targets.reduce((t, r) =>
    t + (r.sharePct / 100) * (r.signal?.decision.rawTargetRatio ?? leadSignal.decision.rawTargetRatio), 0)
  const gap = weighted - current
  const actionRequired = Math.abs(gap) >= rebalanceBandPct
  const tradeKRW = gap * T

  // 통화별 몫: h_i(1 − t_i/c) — 음수(자기 목표가 현재보다 높음)는 0, 나머지를 비율대로 맞춘다
  if (actionRequired && tradeKRW < 0 && current > 0) {
    const raw = targets.map(r => Math.max(0, r.holdingKRW * (1 - r.targetRatio / current)))
    const sum = raw.reduce((t, v) => t + v, 0)
    const need = -tradeKRW
    targets.forEach((r, i) => { r.sellKRW = sum > 0 ? raw[i] * (need / sum) : 0 })
  }

  const action = !actionRequired ? '조치 불필요 — 리밸런싱 밴드 이내'
    : tradeKRW < 0 ? '외화 매도 권고'
    : '외화 보유 확대 권고 (순유입 구조에서는 환전 지연을 의미)'
  const signal: FxRegimeSignal = {
    ...leadSignal,
    decision: {
      ...leadSignal.decision,
      rawTargetRatio: rawWeighted,
      appliedTargetRatio: weighted,
      currentRatio: current,
      suggestedTradeKRW: tradeKRW,
      actionRequired,
      action,
      // 예상 손익은 통화별 FIFO 미리보기(pnlForKRW)로 낸다 — 대표 통화 평균원가 근사는 쓰지 않는다
      expectedRealizedPnlKRW: null,
    },
  }
  return { targets, signal }
}
