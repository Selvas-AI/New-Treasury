/**
 * fxBacktest.ts — 외화 순유입 구조의 환전 타이밍 백테스트 (순수 함수)
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 5
 *
 * ⭐ 판정은 반드시 fxRegime.evaluateRegime() 을 그대로 호출한다.
 *    백테스트용 판정 로직을 따로 만들면 "백테스트는 좋았는데 실전은 다르다"가 되고
 *    아무도 결과를 믿지 않게 된다. 이 파일에는 국면 판정 로직이 한 줄도 없어야 한다.
 *
 * ⚠ look-ahead 금지:
 *    각 시점에서 series.slice(0, i + 1) 만 넘긴다. 전체 배열을 넘기면 미래를 보게 되고,
 *    백테스트 성적이 실제로는 달성 불가능한 수치로 부풀려진다.
 *
 * 매 영업일 월 유입액/20 만큼 외화가 외생적으로 들어오며, 점검일에는 쌓인
 * 외화를 환전할지만 판단한다. 목표보다 외화가 적더라도 매수하지 않는다.
 * 벤치마크는 ① 결제 버퍼 외 즉시 전액 환전, ② 전혀 환전하지 않고 누적이다.
 */
import {
  evaluateRegime,
  type PolicyProtocol,
  type RegimeSeriesPoint,
  type RegimeCode,
} from './fxRegime'
import { availableAmount, consumeFifoLots, unrealizedPnlKRW, weightedBookRate, type FxLot } from './fxLots'

export interface BacktestInput {
  /** 오름차순 일별 환율 (원/외화 1단위) */
  series: RegimeSeriesPoint[]
  /** 시뮬레이션 시작일 YYYY-MM-DD. 이 날짜 이전 구간은 지표 워밍업에만 쓰인다 */
  startDate: string
  /** 시작 시점 가용자금 총액 (외화 보유액 포함) */
  initialTotalKRW: number
  /** 시작 시점 외화 보유액 (외화 단위) */
  initialFxHolding: number
  /** 월 외화 순유입액 (외화 단위, 20영업일로 일할) */
  monthlyInflowFx: number
  /** 항상 남겨야 할 결제 버퍼 (외화 단위) */
  fxPayableFx: number
  /** 정책 밴드 (0~1). null=제약 없음 */
  policyMinRatio: number | null
  policyMaxRatio: number | null
  protocol: PolicyProtocol
  /** 리밸런싱 점검 주기 (영업일). 기본 5 = 주 1회 */
  checkEveryDays?: number
  /** 왕복 거래비용 (bp). 기본 10bp = 0.1% */
  costBps?: number
  /**
   * 평균 취득환율. 지정하면 환전마다 실현손익을 이익/손실로 나눠 집계한다.
   * 순유입 구조라 유입분의 취득환율은 원래 유입 시점 환율이지만,
   * 원장 연동 전까지는 단일 가중평균값으로 근사한다.
   */
  avgAcquisitionRate?: number | null
  /** 미래 시뮬레이션용 현재 실제 원장 로트 */
  initialLots?: FxLot[]
  /** 최대 미환전 노출 한도 (원화). 넘으면 Level 과 무관하게 환전 */
  maxExposureKRW?: number | null
}

export interface BacktestTrade {
  date:      string
  rate:      number
  regime:    RegimeCode
  convertedFx: number
  realizedKRW: number
  costKRW: number
  targetRatio: number
  beforeRatio: number
  afterHoldingFx: number
  /** 평균취득환율 대비 실현손익 (avgAcquisitionRate 미지정 시 null) */
  realizedPnlKRW: number | null
  /** FIFO로 실제 소진된 로트들의 수량가중 평균 원가 */
  fifoConsumedRate: number | null
  /** 거래 직후 남은 FIFO 장부환율 */
  fifoRemainingBookRate: number | null
}

export interface BacktestPoint {
  date:      string
  rate:      number
  strategyHoldingFx: number
  strategyRealizedKRW: number
  immediateRealizedKRW: number
  neverHoldingFx: number
  exposureKRW: number
  regime: RegimeCode | null
  /** 남아 있는 FIFO 로트의 장부환율 */
  fifoBookRate: number | null
  /** 남은 외화의 미실현 평가손익 */
  fifoUnrealizedPnlKRW: number | null
  /** FIFO 누적 실현손익 */
  fifoCumulativeRealizedPnlKRW: number | null
  /** 누적 실현손익 + 남은 외화 평가손익 */
  fifoTotalPnlKRW: number | null
  /** 시작 시점 고원가 개시 로트의 잔여량 */
  openingLotRemainingFx: number | null
}

export interface BacktestResult {
  points: BacktestPoint[]
  trades: BacktestTrade[]
  totalInflowFx: number
  totalAvailableFx: number
  convertedFx: number
  totalRealizedKRW: number
  weightedAverageRate: number | null
  periodAverageRate: number
  ratePremium: number | null
  ratePremiumPct: number | null
  endingHoldingFx: number
  endingHoldingValueKRW: number
  immediateRealizedKRW: number
  immediateWeightedAverageRate: number | null
  neverEndingHoldingFx: number
  neverEndingValueKRW: number
  totalCostKRW: number
  maxExposureFx: number
  maxExposureKRW: number
  tradeCount: number
  skippedChecks: number
  /** 취득원가 대비 실현 이익 합계 (avgAcquisitionRate 지정 시) */
  realizedGainKRW: number
  /** 취득원가 대비 실현 손실 합계 (음수) */
  realizedLossKRW: number
  /** 취득원가 이하로 판 횟수 — 손실 실현이 몇 번 강제됐는지 */
  belowCostTrades: number
  /** 기말 FIFO 장부환율 */
  endingFifoBookRate: number | null
  /** 기말 미실현 평가손익 */
  endingUnrealizedPnlKRW: number | null
  /** 기말 누적 실현손익 + 미실현 평가손익 */
  endingTotalPnlKRW: number | null
}

const EMPTY: BacktestResult = {
  points: [], trades: [], totalInflowFx: 0, totalAvailableFx: 0, convertedFx: 0,
  totalRealizedKRW: 0, weightedAverageRate: null, periodAverageRate: 0,
  ratePremium: null, ratePremiumPct: null, endingHoldingFx: 0, endingHoldingValueKRW: 0,
  immediateRealizedKRW: 0, immediateWeightedAverageRate: null,
  neverEndingHoldingFx: 0, neverEndingValueKRW: 0, totalCostKRW: 0,
  maxExposureFx: 0, maxExposureKRW: 0, tradeCount: 0, skippedChecks: 0,
  realizedGainKRW: 0, realizedLossKRW: 0, belowCostTrades: 0,
  endingFifoBookRate: null, endingUnrealizedPnlKRW: null, endingTotalPnlKRW: null,
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    series, startDate, initialTotalKRW, initialFxHolding, monthlyInflowFx,
    fxPayableFx, policyMinRatio, policyMaxRatio, protocol,
    checkEveryDays = 5, costBps = 10,
    avgAcquisitionRate = null, initialLots = [], maxExposureKRW: maxExposureLimit = null,
  } = input

  const startIdx = series.findIndex(p => p.date >= startDate)
  if (startIdx < 30 || startIdx >= series.length - 1) return EMPTY

  const costRate = Math.max(0, costBps) / 10_000
  const dailyInflow = Math.max(0, monthlyInflowFx) / 20
  const initialHolding = Math.max(0, initialFxHolding)
  const buffer = Math.max(0, fxPayableFx)
  const r0 = series[startIdx].rate
  const baseKrw = Math.max(0, initialTotalKRW - initialHolding * r0)

  let holdingFx = initialHolding
  let realizedKRW = 0
  let convertedFx = 0
  let totalCost = 0
  let totalInflow = 0
  let skipped = 0
  let lastRegime: RegimeCode | null = null
  let maxExposureFx = holdingFx
  let maxExposureKRW = holdingFx * r0
  let realizedGain = 0
  let realizedLoss = 0
  let belowCostTrades = 0
  const fifoEnabled = initialLots.length > 0 || (avgAcquisitionRate != null && avgAcquisitionRate > 0)
  let fifoLots: FxLot[] = initialLots.length > 0
    ? initialLots.map(lot => ({ ...lot }))
    : fifoEnabled && initialHolding > 0
    ? [{ id: 'opening', company: 'simulation', currency: 'FX', acquiredDate: series[startIdx].date,
        originalAmount: initialHolding, remainingAmount: initialHolding,
        acqRate: avgAcquisitionRate ?? 0, accountType: 'demand_deposit', annualInterestRate: 0,
        sourceType: 'opening' }]
    : []
  const openingLotIds = new Set(fifoLots.map(lot => lot.id))
  let fifoCumulativeRealizedPnl = 0
  // 시간 기반 강제 환전용 — 마지막 환전 이후 경과 영업일
  let daysSinceLastConvert = 0

  // 즉시 환전 벤치마크도 결제 버퍼는 보존한다.
  let immediateHoldingFx = Math.min(initialHolding, buffer)
  const initialImmediateSell = Math.max(0, initialHolding - immediateHoldingFx)
  let immediateConvertedFx = initialImmediateSell
  let immediateGross = initialImmediateSell * r0
  let immediateRealized = immediateGross * (1 - costRate)
  let neverHoldingFx = initialHolding
  const points: BacktestPoint[] = []
  const trades: BacktestTrade[] = []

  for (let i = startIdx; i < series.length; i++) {
    const { date, rate } = series[i]

    // 시작일 다음 영업일부터 월 유입액을 20영업일로 일할해 쌓는다.
    if (i > startIdx) {
      holdingFx += dailyInflow
      // 유입일 시장환율을 해당 신규 로트의 취득환율로 둔다.
      if (fifoEnabled && dailyInflow > 0) fifoLots.push({
        id: `inflow-${date}`, company: 'simulation', currency: 'FX', acquiredDate: date,
        originalAmount: dailyInflow, remainingAmount: dailyInflow,
        acqRate: rate, accountType: 'demand_deposit', annualInterestRate: 0, sourceType: 'manual',
      })
      neverHoldingFx += dailyInflow
      totalInflow += dailyInflow

      const bufferGap = Math.max(0, buffer - immediateHoldingFx)
      const retained = Math.min(dailyInflow, bufferGap)
      const sellFx = dailyInflow - retained
      immediateHoldingFx += retained
      immediateConvertedFx += sellFx
      immediateGross += sellFx * rate
      immediateRealized += sellFx * rate * (1 - costRate)
    }

    const isCheckDay = (i - startIdx) % Math.max(1, checkEveryDays) === 0
    if (isCheckDay) {
      const totalKRW = baseKrw + realizedKRW + holdingFx * rate
      const sig = evaluateRegime(
        series.slice(0, i + 1), // ⚠ look-ahead 차단
        {
          totalFundKRW:   totalKRW,
          fxHoldingKRW:   holdingFx * rate,
          fxPayableKRW:   buffer * rate,
          policyMinRatio,
          policyMaxRatio,
          maxExposureKRW: maxExposureLimit,
          daysSinceLastConvert,
          avgAcquisitionRate: fifoEnabled ? weightedBookRate(fifoLots) : avgAcquisitionRate,
        },
        protocol,
      )

      if (!sig) {
        skipped++
      } else {
        lastRegime = sig.regime.code
        const beforeRatio = totalKRW > 0 ? holdingFx * rate / totalKRW : 0
        const desiredHoldingFx = Math.max(
          buffer,
          sig.decision.appliedTargetRatio * totalKRW / rate,
        )
        // 순유입 모델: 목표 미달이면 기다릴 뿐 매수하지 않는다.
        const requestedSellFx = Math.max(0, holdingFx - desiredHoldingFx)
        // 정기예금은 만기일까지 보유액에는 포함되지만 환전 가능액에는 포함하지 않는다.
        const sellFx = fifoEnabled ? Math.min(requestedSellFx, availableAmount(fifoLots, date)) : requestedSellFx
        if (sellFx > 0) {
          const gross = sellFx * rate
          const cost = gross * costRate
          holdingFx -= sellFx
          realizedKRW += gross - cost
          convertedFx += sellFx
          totalCost += cost
          daysSinceLastConvert = 0

          // 취득원가 대비 실현손익 — 실제 FIFO 순서로 오래된 로트부터 소진한다.
          let pnl: number | null = null
          let fifoConsumedRate: number | null = null
          if (fifoEnabled) {
            const fifo = consumeFifoLots(fifoLots, sellFx, rate, date)
            fifoLots = fifo.nextLots
            pnl = fifo.realizedPnlKRW
            fifoConsumedRate = fifo.consumedBookRate
            fifoCumulativeRealizedPnl += fifo.realizedPnlKRW
            if (pnl >= 0) realizedGain += pnl
            else { realizedLoss += pnl; belowCostTrades++ }
          }

          trades.push({
            date, rate, regime: sig.regime.code, convertedFx: sellFx,
            realizedKRW: gross - cost, costKRW: cost,
            targetRatio: sig.decision.appliedTargetRatio, beforeRatio,
            afterHoldingFx: holdingFx, realizedPnlKRW: pnl,
            fifoConsumedRate,
            fifoRemainingBookRate: fifoEnabled ? weightedBookRate(fifoLots) : null,
          })
        }
      }
    }

    daysSinceLastConvert++
    maxExposureFx = Math.max(maxExposureFx, holdingFx)
    maxExposureKRW = Math.max(maxExposureKRW, holdingFx * rate)
    const fifoUnrealized = fifoEnabled ? unrealizedPnlKRW(fifoLots, rate) : null
    points.push({
      date, rate, strategyHoldingFx: holdingFx, strategyRealizedKRW: realizedKRW,
      immediateRealizedKRW: immediateRealized, neverHoldingFx,
      exposureKRW: holdingFx * rate, regime: lastRegime,
      fifoBookRate: fifoEnabled ? weightedBookRate(fifoLots) : null,
      fifoUnrealizedPnlKRW: fifoUnrealized,
      fifoCumulativeRealizedPnlKRW: fifoEnabled ? fifoCumulativeRealizedPnl : null,
      fifoTotalPnlKRW: fifoUnrealized == null ? null : fifoCumulativeRealizedPnl + fifoUnrealized,
      openingLotRemainingFx: fifoEnabled
        ? fifoLots.filter(lot => openingLotIds.has(lot.id)).reduce((sum, lot) => sum + lot.remainingAmount, 0)
        : null,
    })
  }

  const lastRate = series[series.length - 1].rate
  const period = series.slice(startIdx)
  const periodAverageRate = period.reduce((sum, p) => sum + p.rate, 0) / period.length
  const weightedAverageRate = convertedFx > 0
    ? (realizedKRW + totalCost) / convertedFx
    : null
  const ratePremium = weightedAverageRate == null ? null : weightedAverageRate - periodAverageRate

  const endingFifoBookRate = fifoEnabled ? weightedBookRate(fifoLots) : null
  const endingUnrealizedPnlKRW = fifoEnabled ? unrealizedPnlKRW(fifoLots, lastRate) : null
  return {
    points, trades, totalInflowFx: totalInflow,
    totalAvailableFx: initialHolding + totalInflow,
    convertedFx, totalRealizedKRW: realizedKRW, weightedAverageRate, periodAverageRate,
    ratePremium,
    ratePremiumPct: ratePremium == null || periodAverageRate === 0 ? null : ratePremium / periodAverageRate,
    endingHoldingFx: holdingFx, endingHoldingValueKRW: holdingFx * lastRate,
    immediateRealizedKRW: immediateRealized,
    immediateWeightedAverageRate: immediateConvertedFx > 0 ? immediateGross / immediateConvertedFx : null,
    neverEndingHoldingFx: neverHoldingFx, neverEndingValueKRW: neverHoldingFx * lastRate,
    totalCostKRW: totalCost, maxExposureFx, maxExposureKRW,
    tradeCount: trades.length, skippedChecks: skipped,
    realizedGainKRW: realizedGain, realizedLossKRW: realizedLoss, belowCostTrades,
    endingFifoBookRate,
    endingUnrealizedPnlKRW,
    endingTotalPnlKRW: endingUnrealizedPnlKRW == null
      ? null
      : fifoCumulativeRealizedPnl + endingUnrealizedPnlKRW,
  }
}
