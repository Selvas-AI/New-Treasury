import { useCallback, useEffect, useMemo, useState } from 'react'

/** 국면 판정·시뮬레이션에 필요한 자금 컨텍스트 (금액 비율은 0~1). */
export interface FxTreasuryInputs {
  totalFundKRW: number
  fxHoldingFx: number
  /** 전 통화 외화 바구니 원화환산액. 정책밴드 분자 */
  portfolioFxHoldingKRW: number
  monthlyInflowFx: number
  fxPayableFx: number
  policyMinRatio: number | null
  policyMaxRatio: number | null
  /**
   * 평균 취득환율 (원/외화). 매도 시 실현손익 산출용. 0=미설정.
   * ⚠ 취득원가 이하 매도를 **차단하지 않는다** — 비중 상한 해소 등을 위해 필요할 수 있다.
   *   다만 실현 손실액을 반드시 화면에 표시한다(사용자 결정 2026-08-11).
   * 추후 FIFO 원장(docs/기획/외화원장_FIFO_가중평균.md) 연동 예정.
   */
  avgAcquisitionRate: number
  /** 레거시 선택 안전장치. 정책밴드 상한과 중복되어 현재 실시간 워크플로에서는 사용하지 않는다. */
  maxExposureKRW: number
  /**
   * 분기 손실 실현 한도 (원, 양수). 0=미설정.
   * ⚠ 손실을 줄이는 장치가 아니라 **인식 시점을 분산**하는 장치다.
   *   회사는 FIFO 를 쓰므로 지금 팔면 가장 비싼 옛 물량부터 나가 손실이 앞쪽에 집중된다.
   */
  quarterLossCapKRW: number
  /** 이번 분기에 이미 실현한 손실 (원, 양수). 매매 이력 연동 전까지 수동 입력 */
  realizedLossThisQuarterKRW: number
}

export type InputSource = 'manual' | 'treasury'

export interface FxTreasuryInputAdapter extends FxTreasuryInputs {
  source: InputSource
  updateInputs: (patch: Partial<FxTreasuryInputs>) => void
}

const EMPTY_INPUTS: FxTreasuryInputs = {
  totalFundKRW: 0,
  fxHoldingFx: 0,
  portfolioFxHoldingKRW: 0,
  monthlyInflowFx: 0,
  fxPayableFx: 0,
  policyMinRatio: null,
  policyMaxRatio: null,
  avgAcquisitionRate: 0,
  maxExposureKRW: 0,
  quarterLossCapKRW: 0,
  realizedLossThisQuarterKRW: 0,
}

function defaultsFor(company: string): FxTreasuryInputs {
  return {
    ...EMPTY_INPUTS,
    // 순수입 구조가 실측된 법인은 메디아나뿐이다. 다른 법인에 일반화하지 않는다.
    monthlyInflowFx: company === '메디아나' ? 3_000_000 : 0,
    fxPayableFx: company === '메디아나' ? 2_500_000 : 0,
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function nullableRatio(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null
}

function readManualInputs(key: string, defaults: FxTreasuryInputs): FxTreasuryInputs {
  if (typeof window === 'undefined') return defaults
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<FxTreasuryInputs>
    return {
      totalFundKRW: finiteOr(saved.totalFundKRW, defaults.totalFundKRW),
      fxHoldingFx: finiteOr(saved.fxHoldingFx, defaults.fxHoldingFx),
      portfolioFxHoldingKRW: finiteOr(saved.portfolioFxHoldingKRW, defaults.portfolioFxHoldingKRW),
      monthlyInflowFx: finiteOr(saved.monthlyInflowFx, defaults.monthlyInflowFx),
      fxPayableFx: finiteOr(saved.fxPayableFx, defaults.fxPayableFx),
      policyMinRatio: nullableRatio(saved.policyMinRatio),
      policyMaxRatio: nullableRatio(saved.policyMaxRatio),
      avgAcquisitionRate: finiteOr(saved.avgAcquisitionRate, defaults.avgAcquisitionRate),
      maxExposureKRW: finiteOr(saved.maxExposureKRW, defaults.maxExposureKRW),
      quarterLossCapKRW: finiteOr(saved.quarterLossCapKRW, defaults.quarterLossCapKRW),
      realizedLossThisQuarterKRW:
        finiteOr(saved.realizedLossThisQuarterKRW, defaults.realizedLossThisQuarterKRW),
    }
  } catch {
    return defaults
  }
}

/**
 * 입력 소스를 교체하기 위한 어댑터 심.
 *
 * manual: 법인·통화별 localStorage 값을 사용한다.
 * treasury: usePolicyDashboard의 전사 외화 바구니/정책 분모와
 *           usePolicyParams(fx_target_min/max)를 연결한다.
 */
export function useFxTreasuryInputs(
  source: InputSource,
  company: string,
  currency: string,
  treasuryValues: Partial<FxTreasuryInputs> = {},
): FxTreasuryInputAdapter {
  const storageKey = `fx_regime_inputs_${company}_${currency}`
  const defaults = useMemo(() => defaultsFor(company), [company])
  const [manual, setManual] = useState<FxTreasuryInputs>(() =>
    readManualInputs(storageKey, defaults),
  )

  useEffect(() => {
    // 법인·통화 키가 바뀌면 해당 로컬 스냅샷으로 교체한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManual(readManualInputs(storageKey, defaults))
  }, [storageKey, defaults])

  const updateInputs = useCallback((patch: Partial<FxTreasuryInputs>) => {
    setManual(prev => {
      const next = { ...prev, ...patch }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      }
      return next
    })
  }, [storageKey])

  const values = source === 'treasury'
    ? { ...manual, ...treasuryValues }
    : manual
  return useMemo(() => ({ ...values, source, updateInputs }), [values, source, updateInputs])
}
