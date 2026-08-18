/**
 * useFxRegime — 환율 국면 판정 SSOT 훅
 *
 * 세션26차 신규. 근거: docs/기획/FX리짐_정책이관_계획.md §7 Phase 2
 *
 * 실무 화면(/fx-regime)과 정책 화면(/policy › FX 정책)이 **같은 판정**을 봐야 한다.
 * 계산이 두 화면에 각각 복제되면 반드시 갈라진다 — 세션19차에 분모 불일치로
 * 같은 법인의 외화비중이 6.2% vs 27.9% 로 표시된 사고가 있었다.
 * 그래서 시계열 수집 → 프로토콜 조립 → 컨텍스트 구성 → evaluateRegime 까지의
 * 전 경로를 이 훅 하나에 모은다.
 *
 * ⚠ 판정 경로는 하나뿐이다 — evaluateRegime(series, ctx, protocol, currency).
 *   화면에서 별도로 목표비중을 다시 계산하지 말 것.
 */
import { useMemo } from 'react'
import { usePolicyParams } from './usePolicyParams'
import { usePolicyDashboard } from './usePolicyDashboard'
import { useFxLots } from './useFxLots'
import { useFxHistory } from './useFxHistory'
import {
  evaluateRegime, protocolFromParams,
  type RegimeSeriesPoint, type TreasuryContext, type FxRegimeSignal,
  type PolicyProtocol,
} from '../lib/fxRegime'
import {
  useFxTreasuryInputs,
  type FxTreasuryInputAdapter, type FxTreasuryInputs, type InputSource,
} from '../lib/fxRegimeInputs'

/** 판정에 필요한 최소 표본 — 이보다 짧으면 signal 은 null 이다 */
export const MIN_SERIES_LENGTH = 30

export interface FxRegimeBundle {
  params:   ReturnType<typeof usePolicyParams>
  policyData: ReturnType<typeof usePolicyDashboard>
  fxLots:   ReturnType<typeof useFxLots>
  hist:     ReturnType<typeof useFxHistory>
  inputs:   FxTreasuryInputAdapter
  series:   RegimeSeriesPoint[]
  protocol: PolicyProtocol
  ctx:      TreasuryContext
  signal:   FxRegimeSignal | null
  /** 최신 종가 (원/외화). 데이터가 없으면 0 */
  latestRate: number
  /** 향후 3개월 결제 예정액 — 외화 원금과 원화 환산액 */
  fxPayableFx: number
  fxPayableKRW: number
  /** 실제로 환전 가능한 재고 (FIFO 잠금 반영). 로트가 없으면 보유액으로 폴백 */
  availableFx: number
  /** 정책 밴드가 뒤집혀 있으면 false — 이때 밴드 제약은 적용하지 않는다 */
  validPolicyBand: boolean
  /** 전사 외화 바구니 (통화별 원금·원화환산) */
  basket: { code: string; nativeAmount: number; krwAmount: number }[]
}

/**
 * @param source 'live'=실데이터(권고 생성) / 'simulation'=저장 안 되는 실험 모드
 * @param autoSync 최신 환율 이력 자동 보충 여부 — 실무 화면만 true 로 둔다
 *                 (정책 화면까지 켜면 같은 GAS/ECOS 호출이 중복된다)
 */
export function useFxRegime(
  company: string,
  currency: string,
  source: InputSource = 'live',
  autoSync = false,
): FxRegimeBundle {
  const params     = usePolicyParams(company)
  const policyData = usePolicyDashboard(company)
  const fxLots     = useFxLots(company, currency)
  const hist       = useFxHistory(currency, { autoSync })

  // ── Treasury 조회값 ────────────────────────────────────────────────
  const latestDaily = policyData.latestDaily as unknown as Record<string, unknown> | null
  // daily.fx_usd 등 통화별 필드는 외화 원금이다. fx_krw 만 전 통화 원화환산 합계다.
  const operatingFxNative = Number(latestDaily?.[`fx_${currency.toLowerCase()}`] ?? 0)
  const treasuryNativeHolding = operatingFxNative +
    policyData.investments
      .filter(i => i.available === '가용' && i.currency === currency)
      .reduce((sum, i) => sum + (i.amount || 0), 0)

  const treasuryValues = useMemo<Partial<FxTreasuryInputs>>(() => ({
    totalFundKRW:          policyData.fxPolicyDenominator,
    fxHoldingFx:           fxLots.totalAmount > 0 ? fxLots.totalAmount : treasuryNativeHolding,
    portfolioFxHoldingKRW: policyData.fxPortfolioHoldings,
    avgAcquisitionRate:    fxLots.bookRate ?? 0,
  }), [policyData.fxPolicyDenominator, policyData.fxPortfolioHoldings,
       treasuryNativeHolding, fxLots.totalAmount, fxLots.bookRate])

  const inputs = useFxTreasuryInputs(source, company, currency, treasuryValues, params)

  // ── 판정 입력 ──────────────────────────────────────────────────────
  const series: RegimeSeriesPoint[] = useMemo(
    () => hist.data.map(p => ({ date: p.date, rate: p.rate })),
    [hist.data],
  )
  const latestRate = series[series.length - 1]?.rate ?? 0

  // 결제 버퍼는 **외화 원금**으로 보관한다 — 실제 채무는 "250만불"이지 "X원"이 아니다.
  // 원화로 굳혀두면 환율이 오를수록 버퍼가 과소평가되어, 정작 방어가 필요한 국면에
  // 하한이 낮아지는 역효과가 난다.
  const fxPayableFx  = inputs.fxPayableFx
  const fxPayableKRW = fxPayableFx * latestRate

  const validPolicyBand = inputs.policyMinRatio == null ||
    inputs.policyMaxRatio == null ||
    inputs.policyMinRatio <= inputs.policyMaxRatio

  const ctx = useMemo<TreasuryContext>(() => ({
    totalFundKRW: inputs.totalFundKRW,
    fxHoldingKRW: inputs.portfolioFxHoldingKRW,
    // ⚠ 0 이면 버퍼 하한이 사라져 알고리즘이 전량 매도를 제안할 수 있다.
    fxPayableKRW,
    policyMaxRatio: validPolicyBand ? inputs.policyMaxRatio : null,
    policyMinRatio: validPolicyBand ? inputs.policyMinRatio : null,
    // 정책밴드 상한과 중복되는 고정 원화 노출 한도는 사용하지 않는다.
    maxExposureKRW: null,
    avgAcquisitionRate: inputs.avgAcquisitionRate > 0 ? inputs.avgAcquisitionRate : null,
    // 실시간 판정에는 "마지막 환전 이후 경과일" 이력이 없다 — 시간 기반 강제 환전은
    // 백테스트에서만 활성화된다.
    daysSinceLastConvert: null,
  }), [inputs.totalFundKRW, inputs.portfolioFxHoldingKRW, fxPayableKRW,
       inputs.policyMaxRatio, inputs.policyMinRatio, validPolicyBand,
       inputs.avgAcquisitionRate])

  // 프로토콜은 policy_params 에서 조립 — 값이 없으면 코드 기본값
  const protocol = useMemo(() => protocolFromParams(k => params.get(k)), [params])

  const signal = useMemo(
    () => (series.length >= MIN_SERIES_LENGTH ? evaluateRegime(series, ctx, protocol, currency) : null),
    [series, ctx, protocol, currency],
  )

  const availableFx = fxLots.totalAmount > 0 ? fxLots.availableAmount : inputs.fxHoldingFx

  const basket = useMemo(() => {
    if (source !== 'simulation') {
      return Object.entries(policyData.fxByCurrency).map(([code, row]) => ({ code, ...row }))
    }
    // 시뮬레이션은 임의 가정값이라 전사 바구니를 구성할 수 없다 — 해당 통화만 보여준다.
    return [{
      code: currency,
      nativeAmount: inputs.fxHoldingFx,
      krwAmount: inputs.fxHoldingFx * latestRate,
    }]
  }, [source, policyData.fxByCurrency, inputs.fxHoldingFx, latestRate, currency])

  return {
    params, policyData, fxLots, hist, inputs,
    series, protocol, ctx, signal,
    latestRate, fxPayableFx, fxPayableKRW, availableFx, validPolicyBand, basket,
  }
}
