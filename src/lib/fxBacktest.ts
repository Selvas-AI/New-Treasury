/**
 * fxBacktest.ts — 환율 국면 프로토콜 백테스트 (순수 함수)
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
 * 모델:
 *   포트폴리오 = 원화현금(KRW) + 외화(USD). 총자산(원화환산) = krw + usd × 환율.
 *   목표 비율은 총자산 대비 외화 평가액 비중을 뜻한다.
 *   벤치마크는 "아무것도 안 함"(Buy & Hold) — 초기 비중을 그대로 유지하며 환율만 반영된다.
 *
 * ⛔ [중대 한계] 이 모델은 **외화 순수입(수출) 구조에 맞지 않는다.**
 *   여기서는 "고정된 자금 풀을 목표 비중으로 리밸런싱"한다고 가정하므로,
 *   비중이 목표에 미달하면 **외화를 매수**한다. 그러나 실측 결과 이 회사는
 *   fx_trade_history 12건이 전부 sell 이고 매수 이력이 0건이며,
 *   매달 약 3.0M USD 가 자동으로 유입된다(fxRegime.DEFAULT_TARGETS 주석의 실측 근거 참조).
 *
 *   그 결과 2026-08-11 실행분에서 하지도 않을 매수가 다수 생성되어
 *   "밴드 무시 시 −2.3억, 69회 거래" 같은 왜곡된 성과가 나왔다. 이 수치는 신뢰할 수 없다.
 *
 *   순수입 구조에 맞는 모델은 다음이어야 한다:
 *     · 매기 외화가 외생적으로 유입된다(월 유입액을 입력받음)
 *     · 의사결정은 매수/매도가 아니라 **"이번에 들어온 외화를 지금 환전할지 미룰지"**
 *     · 벤치마크는 "고정 비중 유지"가 아니라 ①즉시 전액 환전 ②전혀 환전 안 함(계속 누적)
 *   → 재설계 전까지 이 백테스트의 손익 수치를 정책 근거로 인용하지 말 것.
 *
 * 한계(의도적으로 단순화한 부분):
 *   - 이자(원화 예금금리 vs 외화 예금금리) 미반영. 국면 판정의 효과만 분리해 보기 위함.
 *   - 실현 환차손익은 **가중평균법**. FIFO 는 별도 원장 기획(외화원장_FIFO_가중평균.md) 소관.
 *   - 총자산은 매매 외 유입/유출이 없다고 가정(운전자본 변동 미반영).
 */
import {
  evaluateRegime,
  type PolicyProtocol,
  type RegimeSeriesPoint,
  type RegimeCode,
} from './fxRegime'

export interface BacktestInput {
  /** 오름차순 일별 환율 (원/외화 1단위) */
  series: RegimeSeriesPoint[]
  /** 시뮬레이션 시작일 YYYY-MM-DD. 이 날짜 이전 구간은 지표 워밍업에만 쓰인다 */
  startDate: string
  /** 시작 시점 총자산 (원화환산) */
  initialTotalKRW: number
  /** 시작 시점 외화 비중 (0~1) */
  initialFxRatio: number
  /** 향후 결제 예정 외화 (외화 단위) — 목표 비율의 하한을 만든다 */
  fxPayableFx: number
  /** 정책 밴드 (0~1). null=제약 없음 */
  policyMinRatio: number | null
  policyMaxRatio: number | null
  protocol: PolicyProtocol
  /** 리밸런싱 점검 주기 (영업일). 기본 5 = 주 1회 */
  checkEveryDays?: number
  /** 왕복 거래비용 (bp). 기본 10bp = 0.1% */
  costBps?: number
}

export interface BacktestTrade {
  date:      string
  rate:      number
  regime:    RegimeCode
  /** + 매수 / − 매도 (외화 단위) */
  amountFx:  number
  /** 원화 기준 거래대금 (절대값) */
  notionalKRW: number
  costKRW:   number
  /** 매도 시 실현 환차손익 (가중평균 취득환율 기준). 매수는 0 */
  realizedPnlKRW: number
  targetRatio:  number
  beforeRatio:  number
}

export interface BacktestPoint {
  date:      string
  rate:      number
  /** 전략 총자산 (원화환산) */
  strategy:  number
  /** 아무것도 안 했을 때 총자산 */
  buyHold:   number
  fxRatio:   number
  regime:    RegimeCode | null
}

export interface BacktestResult {
  points: BacktestPoint[]
  trades: BacktestTrade[]
  /** 전략 기말 총자산 */
  finalStrategyKRW: number
  /** Buy & Hold 기말 총자산 */
  finalBuyHoldKRW:  number
  /** 초과 성과 (전략 − B&H) */
  excessKRW:        number
  totalCostKRW:     number
  realizedPnlKRW:   number
  /** 최대 낙폭 (0~1) */
  maxDrawdown:      number
  buyHoldMaxDrawdown: number
  tradeCount:       number
  /** 판정에 필요한 표본이 모자라 건너뛴 점검 횟수 */
  skippedChecks:    number
}

const EMPTY: BacktestResult = {
  points: [], trades: [], finalStrategyKRW: 0, finalBuyHoldKRW: 0, excessKRW: 0,
  totalCostKRW: 0, realizedPnlKRW: 0, maxDrawdown: 0, buyHoldMaxDrawdown: 0,
  tradeCount: 0, skippedChecks: 0,
}

function maxDrawdownOf(values: number[]): number {
  let peak = -Infinity
  let mdd = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = (peak - v) / peak
      if (dd > mdd) mdd = dd
    }
  }
  return mdd
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    series, startDate, initialTotalKRW, initialFxRatio, fxPayableFx,
    policyMinRatio, policyMaxRatio, protocol,
    checkEveryDays = 5, costBps = 10,
  } = input

  const startIdx = series.findIndex(p => p.date >= startDate)
  // 판정에는 최소 30개 표본이 필요하고, 변동성 Z-Score 까지 쓰려면 272개가 있어야 한다.
  // 워밍업 구간이 없으면 시작 직후 판정이 전부 null 이 되어 의미 있는 비교가 불가능하다.
  if (startIdx < 30 || startIdx >= series.length - 1) return EMPTY

  const cost = costBps / 10000
  const r0 = series[startIdx].rate

  // 전략 포지션
  let usd = (initialTotalKRW * initialFxRatio) / r0
  let krw = initialTotalKRW * (1 - initialFxRatio)
  let avgCostRate = r0                    // 가중평균 취득환율

  // 벤치마크: 초기 상태 그대로 보유
  const bhUsd = usd
  const bhKrw = krw

  const points: BacktestPoint[] = []
  const trades: BacktestTrade[] = []
  let totalCost = 0
  let realizedPnl = 0
  let skipped = 0
  let lastRegime: RegimeCode | null = null

  for (let i = startIdx; i < series.length; i++) {
    const { date, rate } = series[i]
    const isCheckDay = (i - startIdx) % checkEveryDays === 0

    if (isCheckDay) {
      const totalKRW = krw + usd * rate
      const sig = evaluateRegime(
        series.slice(0, i + 1),          // ⚠ look-ahead 차단
        {
          totalFundKRW:   totalKRW,
          fxHoldingKRW:   usd * rate,
          fxPayableKRW:   fxPayableFx * rate,
          policyMinRatio,
          policyMaxRatio,
        },
        protocol,
      )

      if (!sig) {
        skipped++
      } else {
        lastRegime = sig.regime.code
        if (sig.decision.actionRequired) {
          const beforeRatio = (usd * rate) / totalKRW
          const target = sig.decision.appliedTargetRatio
          const desiredFxKRW = target * totalKRW
          const deltaKRW = desiredFxKRW - usd * rate     // + 매수 / − 매도

          if (deltaKRW < 0) {
            // 매도
            const sellKRW = Math.min(-deltaKRW, usd * rate)
            const sellFx  = sellKRW / rate
            const c       = sellKRW * cost
            const pnl     = sellFx * (rate - avgCostRate)   // 가중평균법 실현손익
            usd -= sellFx
            krw += sellKRW - c
            totalCost   += c
            realizedPnl += pnl
            trades.push({
              date, rate, regime: sig.regime.code, amountFx: -sellFx,
              notionalKRW: sellKRW, costKRW: c, realizedPnlKRW: pnl,
              targetRatio: target, beforeRatio,
            })
            // 매도는 평균단가를 바꾸지 않는다 (수량만 감소)
          } else if (deltaKRW > 0) {
            // 매수
            const buyKRW = Math.min(deltaKRW, krw)
            if (buyKRW > 0) {
              const c     = buyKRW * cost
              const buyFx = (buyKRW - c) / rate
              // 가중평균 취득환율 갱신
              avgCostRate = (usd * avgCostRate + buyFx * rate) / (usd + buyFx)
              usd += buyFx
              krw -= buyKRW
              totalCost += c
              trades.push({
                date, rate, regime: sig.regime.code, amountFx: buyFx,
                notionalKRW: buyKRW, costKRW: c, realizedPnlKRW: 0,
                targetRatio: target, beforeRatio,
              })
            }
          }
        }
      }
    }

    const strategy = krw + usd * rate
    const buyHold  = bhKrw + bhUsd * rate
    points.push({ date, rate, strategy, buyHold, fxRatio: (usd * rate) / strategy, regime: lastRegime })
  }

  const finalStrategy = points[points.length - 1].strategy
  const finalBuyHold  = points[points.length - 1].buyHold

  return {
    points,
    trades,
    finalStrategyKRW: finalStrategy,
    finalBuyHoldKRW:  finalBuyHold,
    excessKRW:        finalStrategy - finalBuyHold,
    totalCostKRW:     totalCost,
    realizedPnlKRW:   realizedPnl,
    maxDrawdown:        maxDrawdownOf(points.map(p => p.strategy)),
    buyHoldMaxDrawdown: maxDrawdownOf(points.map(p => p.buyHold)),
    tradeCount:       trades.length,
    skippedChecks:    skipped,
  }
}
