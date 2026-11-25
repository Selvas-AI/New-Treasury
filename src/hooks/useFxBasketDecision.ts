/**
 * useFxBasketDecision — 외화 바구니 판정 조회 훅 (2026-11-25 전수조사 F-05)
 *
 * 데이터만 모으고 판정은 lib/fxBasketDecision 의 순수 함수가 한다.
 * 소비처: FX 리짐 전략(조치 카드·매각 지시·스냅샷), 자금정책 ① 리짐 이행 현황.
 *
 * ⚠ 통화 탭을 인자로 받지 않는다 — 탭과 무관한 결론이어야 한다.
 *
 * ⚠ `ready` 는 **모든 소스가 실제로 한 번 로드를 거친 뒤에만** true 다.
 *   usePolicyDashboard 의 loading 초기값이 false 라, 마운트 직후 첫 렌더는 빈 데이터인데도
 *   "로딩 중 아님"으로 보인다. 그 상태로 스냅샷을 쓰면 권고 발생일(since)이 리셋된다
 *   (세션26차 2일차 실사고). 스냅샷 기록은 반드시 ready 를 확인할 것.
 */
import { useEffect, useMemo, useRef } from 'react'
import { usePolicyDashboard } from './usePolicyDashboard'
import { usePolicyParams } from './usePolicyParams'
import { useFxHistory } from './useFxHistory'
import { useFxLots } from './useFxLots'
import { useFx } from './useFx'
import { computeFxBandExceed } from '../lib/fxBandExceed'
import { buildBasketDecision, type BasketDecision, type BasketCurrencyInput } from '../lib/fxBasketDecision'
import { FX_OPS_PARAM_KEYS, regimeOpsFallback } from '../lib/fxRegimeInputs'
import { REGIME_SNAPSHOT_KEYS, BASKET_SNAPSHOT_CURRENCY } from '../lib/fxRegimeSnapshot'
import { todayStr } from '../lib/bizDay'
import type { RegimeOrderCurrencyInfo } from '../lib/fxRegimeOrder'
import type { TreasuryContext } from '../lib/fxRegime'
import type { Company } from '../types'

type PolicyData = ReturnType<typeof usePolicyDashboard>
type Params = ReturnType<typeof usePolicyParams>

export interface FxBasketDecisionResult extends BasketDecision {
  /** 통화별 장부 요약 — 매각 지시 payload(장부환율·환전 가능 재고)에 쓴다 */
  lotsInfo: Partial<Record<string, RegimeOrderCurrencyInfo>>
  loading: boolean
  /** 모든 소스가 실제 로드를 마쳤다 — 스냅샷 기록 가능 */
  ready: boolean
}

export function useFxBasketDecision(company: Company, opts: {
  /** 이미 조회한 값이 있으면 넘긴다(중복 조회 방지) */
  policyData?: PolicyData
  params?: Params
  /** 시뮬레이션 모드 실험값 — 조치 카드가 실험값을 따라가게 한다. 스냅샷은 쓰지 않는다 */
  ctxOverride?: Partial<TreasuryContext> | null
} = {}): FxBasketDecisionResult {
  const ownPolicy = usePolicyDashboard(opts.policyData ? null : company)
  const ownParams = usePolicyParams(opts.params ? null : company)
  const policyData = opts.policyData ?? ownPolicy
  const params = opts.params ?? ownParams

  const fx = useFx()
  useEffect(() => { void fx.fetchRates() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 통화별 이력·장부 — REGIME_CURRENCIES 고정 4종(훅 순서가 항상 같다)
  const hUSD = useFxHistory('USD'); const hEUR = useFxHistory('EUR')
  const hJPY = useFxHistory('JPY'); const hGBP = useFxHistory('GBP')
  const lUSD = useFxLots(company, 'USD'); const lEUR = useFxLots(company, 'EUR')
  const lJPY = useFxLots(company, 'JPY'); const lGBP = useFxLots(company, 'GBP')

  const loading = policyData.loading || params.loading
    || hUSD.loading || hEUR.loading || hJPY.loading || hGBP.loading
    || lUSD.loading || lEUR.loading || lJPY.loading || lGBP.loading

  // "로드를 실제로 거쳤는가" — 법인이 바뀌면 다시 센다
  const sawPolicyRef = useRef<string>('')
  if (policyData.loading) sawPolicyRef.current = company
  const ready = !loading && sawPolicyRef.current === company

  const get = (k: string) => params.get(k)
  const getText = (k: string) => params.getText(k)
  const today = todayStr()

  const decision = useMemo(() => {
    const cur = (code: string, h: typeof hUSD, l: typeof lUSD): BasketCurrencyInput => {
      const fb = regimeOpsFallback(company, code)
      const payable = get(FX_OPS_PARAM_KEYS.payable(code))
      return {
        series: h.series,
        lots: l.lots.length ? { totalAmount: l.totalAmount, availableAmount: l.availableAmount, bookRate: l.bookRate } : null,
        payableFx: payable != null && payable >= 0 ? payable : fb.fxPayableFx,
      }
    }
    const lossCap  = get(FX_OPS_PARAM_KEYS.lossCap) ?? 0
    const lossUsed = get(FX_OPS_PARAM_KEYS.lossUsed) ?? 0
    return buildBasketDecision({
      basket: policyData.fxByCurrency,
      denominatorKRW: policyData.fxPolicyDenominator,
      holdingsKRW: policyData.fxPortfolioHoldings,
      get,
      currencies: {
        USD: cur('USD', hUSD, lUSD), EUR: cur('EUR', hEUR, lEUR),
        JPY: cur('JPY', hJPY, lJPY), GBP: cur('GBP', hGBP, lGBP),
      },
      marketRates: Object.fromEntries(fx.rates.map(r => [r.code, r.rate])),
      bandExceed: computeFxBandExceed(policyData, params),
      quarterLossCapKRW: Math.max(0, lossCap),
      realizedLossKRW: Math.max(0, lossUsed),
      prevLead: getText(REGIME_SNAPSHOT_KEYS.lead(BASKET_SNAPSHOT_CURRENCY)),
      today,
      ctxOverride: opts.ctxOverride ?? null,
    })
    // params 는 메모이즈되지 않은 객체라 deps 로 쓰면 매 렌더 재계산된다 — 대신 data 를 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, policyData, params.data, fx.rates, today, opts.ctxOverride,
      hUSD.series, hEUR.series, hJPY.series, hGBP.series,
      lUSD.lots, lEUR.lots, lJPY.lots, lGBP.lots,
      lUSD.totalAmount, lEUR.totalAmount, lJPY.totalAmount, lGBP.totalAmount])

  const lotsInfo = useMemo(() => {
    const info = (l: typeof lUSD): RegimeOrderCurrencyInfo => ({
      bookRate: l.bookRate,
      // 로트가 없으면(원장 미적용 통화) 재고 제한을 두지 않는다 — 서버가 체결 시 막는다
      availableFx: l.lots.length ? l.availableAmount : null,
    })
    return { USD: info(lUSD), EUR: info(lEUR), JPY: info(lJPY), GBP: info(lGBP) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lUSD.lots, lEUR.lots, lJPY.lots, lGBP.lots])

  return useMemo(() => ({ ...decision, lotsInfo, loading, ready }), [decision, lotsInfo, loading, ready])
}
