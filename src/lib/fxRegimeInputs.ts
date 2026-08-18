/**
 * fxRegimeInputs — 환율 국면 판정에 들어가는 자금·정책 컨텍스트 어댑터
 *
 * 세션26차 재작성. 근거: docs/기획/FX리짐_정책이관_계획.md §2, §3
 *
 * ⭐ 소유권 원칙 — **가정은 정책, 사실은 실무**
 *   policy   : 정책회의만 편집 (밴드·월유입·결제버퍼·손실한도)
 *   ops      : 실무자가 사실을 기록 (이번 분기 기실현 손실)
 *   treasury : 실데이터 조회값 — 아무도 편집 불가
 *
 * ⚠ 과거에는 이 값들을 `localStorage`(fx_regime_inputs_{법인}_{통화})에 저장했다.
 *   서버에 없으니 정책회의 화면에서 보이지도, 정정할 수도 없었고 담당자 PC마다
 *   값이 달라도 아무도 몰랐다. 전부 policy_params(법인 단위)로 올렸다.
 *   localStorage 로 되돌리지 말 것.
 *
 * ⚠ 단위: 정책 밴드는 DB 에 **%**(20)로 저장되고 엔진은 **0~1**(0.20)을 쓴다.
 *   변환은 이 파일의 pctToRatio 한 곳에만 둔다. 두 군데서 나누면 20% 가
 *   2000% 로 들어간다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
   * FIFO 원장(useFxLots)의 잔존 장부환율을 조회해 채운다.
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
  /** 이번 분기에 이미 실현한 손실 (원, 양수). 매매 이력 연동 전까지 실무 입력 */
  realizedLossThisQuarterKRW: number
}

/**
 * live       — Treasury 실데이터 + 정책 파라미터. **실제 권고가 나오는 유일한 경로.**
 * simulation — 값을 임의로 바꿔보는 실험 모드. 저장하지 않고 새로고침하면 사라진다.
 */
export type InputSource = 'live' | 'simulation'

/** 필드 소유 주체 — 화면 잠금·배지 표시의 근거 */
export type FieldOwner = 'policy' | 'ops' | 'treasury'

export type FxInputField = keyof FxTreasuryInputs

/**
 * 리짐 판정을 돌리는 통화. ECOS 일별 매매기준율이 제공되는 4종.
 * ⚠ 화면마다 따로 배열을 두면 한쪽만 늘어나 통화가 조용히 누락된다 — 여기서만 정의한다.
 */
export const REGIME_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP'] as const

const FIELD_OWNER: Record<FxInputField, FieldOwner> = {
  totalFundKRW:               'treasury',
  fxHoldingFx:                'treasury',
  portfolioFxHoldingKRW:      'treasury',
  avgAcquisitionRate:         'treasury',
  monthlyInflowFx:            'policy',
  fxPayableFx:                'policy',
  quarterLossCapKRW:          'policy',
  policyMinRatio:             'policy',
  policyMaxRatio:             'policy',
  maxExposureKRW:             'policy',
  realizedLossThisQuarterKRW: 'ops',
}

export function ownerOf(field: FxInputField): FieldOwner {
  return FIELD_OWNER[field]
}

/** policy_params 키 — 리짐 운영 가정 (§5) */
export const FX_OPS_PARAM_KEYS = {
  /** 월 외화 유입 가정 (통화별, 외화 원금) */
  monthlyInflow: (currency: string) => `fx_ops_monthly_inflow_${currency.toLowerCase()}`,
  /** 향후 3개월 결제 버퍼 (통화별, 외화 원금) */
  payable:       (currency: string) => `fx_ops_payable_${currency.toLowerCase()}`,
  /** 분기 손실 실현 한도 (원) */
  lossCap:  'fx_ops_loss_cap',
  /** 이번 분기 기실현 손실 (원) */
  lossUsed: 'fx_ops_loss_used',
  /** 정책 밴드 — 기존 FX 정책 탭과 공유. **% 단위** */
  bandMin: 'fx_target_min',
  bandMax: 'fx_target_max',
} as const

/** usePolicyParams 가 제공하는 최소 인터페이스 */
export interface FxParamStore {
  get: (key: string) => number | null
  set?: (
    key: string, value: number | null, text: string | null, updatedBy: string,
  ) => Promise<string | null>
}

export interface FxTreasuryInputAdapter extends FxTreasuryInputs {
  source: InputSource
  /** 시뮬레이션 모드 전용. live 모드에서는 아무 일도 하지 않는다. */
  updateInputs: (patch: Partial<FxTreasuryInputs>) => void
  /** 시뮬레이션 값을 버리고 실데이터로 되돌린다. */
  resetSimulation: () => void
  /** 시뮬레이션에서 실제로 바꾼 값이 있는가 (배너 표시용) */
  simulationDirty: boolean
  /** 실무 입력(사실 기록) 저장 — policy_params 에 영속한다. */
  saveOpsInput: (
    patch: Partial<Pick<FxTreasuryInputs, 'realizedLossThisQuarterKRW'>>,
    updatedBy: string,
  ) => Promise<string | null>
  ownerOf: (field: FxInputField) => FieldOwner
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** DB 저장 단위(%) → 엔진 단위(0~1). 미설정이면 null(제약 없음). */
function pctToRatio(pct: number | null): number | null {
  if (pct == null || !Number.isFinite(pct)) return null
  return Math.min(1, Math.max(0, pct / 100))
}

/**
 * 정책 파라미터가 아직 설정되지 않았을 때 판정에 쓰는 임시 기본값.
 *
 * ⚠ 실측된 것은 **메디아나의 USD 수급**뿐이다. 통화를 가리지 않고 적용하면
 *   EUR·JPY·GBP 에도 월 300만 유입과 250만 결제 버퍼가 있다고 가정하게 되어
 *   해당 통화의 버퍼 하한이 근거 없이 올라간다(= 환전을 덜 하게 된다).
 *
 * ⚠ 이 값은 **화면에도 같이 노출**해야 한다. 정책 화면에 0으로 보이는데 판정에는
 *   300만이 들어가면 회의체가 실제 적용값을 알 수 없다(세션26차 브라우저 검증에서 발견).
 */
export function regimeOpsFallback(company: string, currency: string):
  { monthlyInflowFx: number; fxPayableFx: number } {
  return company === '메디아나' && currency.toUpperCase() === 'USD'
    ? { monthlyInflowFx: 3_000_000, fxPayableFx: 2_500_000 }
    : { monthlyInflowFx: 0, fxPayableFx: 0 }
}

/**
 * 국면 판정 입력을 조립한다.
 *
 * @param source         live=실데이터(권고 생성) / simulation=실험(저장 안 함)
 * @param treasuryValues usePolicyDashboard·useFxLots 조회값
 * @param params         usePolicyParams(company)
 */
export function useFxTreasuryInputs(
  source: InputSource,
  company: string,
  currency: string,
  treasuryValues: Partial<FxTreasuryInputs>,
  params: FxParamStore,
): FxTreasuryInputAdapter {
  // ⚠ usePolicyParams 의 get/set 은 메모이즈되어 있지 않아 매 렌더 새 참조다.
  //   deps 에 넣으면 렌더 루프가 나므로 ref 로 최신값만 들고 primitive 만 deps 에 쓴다.
  //   (CLAUDE.md §10 — 훅 반환 객체 미메모이즈 → 무한 렌더 루프)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const [draft, setDraft] = useState<Partial<FxTreasuryInputs> | null>(null)

  // 법인·통화가 바뀌거나 실데이터 모드로 돌아오면 실험값은 버린다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(null)
  }, [company, currency, source])

  const fallback = regimeOpsFallback(company, currency)

  // ── 실데이터 값 (primitive 로 뽑아 memo deps 안정화) ─────────────────
  const totalFundKRW          = finiteOr(treasuryValues.totalFundKRW, 0)
  const fxHoldingFx           = finiteOr(treasuryValues.fxHoldingFx, 0)
  const portfolioFxHoldingKRW = finiteOr(treasuryValues.portfolioFxHoldingKRW, 0)
  const avgAcquisitionRate    = finiteOr(treasuryValues.avgAcquisitionRate, 0)

  const monthlyInflowFx = finiteOr(
    params.get(FX_OPS_PARAM_KEYS.monthlyInflow(currency)), fallback.monthlyInflowFx)
  const fxPayableFx = finiteOr(
    params.get(FX_OPS_PARAM_KEYS.payable(currency)), fallback.fxPayableFx)
  const quarterLossCapKRW = finiteOr(params.get(FX_OPS_PARAM_KEYS.lossCap), 0)
  const realizedLossThisQuarterKRW = finiteOr(params.get(FX_OPS_PARAM_KEYS.lossUsed), 0)
  const policyMinRatio = pctToRatio(params.get(FX_OPS_PARAM_KEYS.bandMin))
  const policyMaxRatio = pctToRatio(params.get(FX_OPS_PARAM_KEYS.bandMax))

  const updateInputs = useCallback((patch: Partial<FxTreasuryInputs>) => {
    // live 모드에서는 편집 자체를 받지 않는다 — 정책값을 실무가 덮어쓰는 경로를 없앤다.
    if (source !== 'simulation') return
    setDraft(prev => ({ ...(prev ?? {}), ...patch }))
  }, [source])

  const resetSimulation = useCallback(() => setDraft(null), [])

  const saveOpsInput = useCallback(async (
    patch: Partial<Pick<FxTreasuryInputs, 'realizedLossThisQuarterKRW'>>,
    updatedBy: string,
  ): Promise<string | null> => {
    const set = paramsRef.current.set
    if (!set) return '저장할 수 없는 컨텍스트입니다.'
    if (patch.realizedLossThisQuarterKRW == null) return null
    return set(FX_OPS_PARAM_KEYS.lossUsed,
      Math.max(0, patch.realizedLossThisQuarterKRW), null, updatedBy)
  }, [])

  return useMemo(() => {
    const live: FxTreasuryInputs = {
      totalFundKRW, fxHoldingFx, portfolioFxHoldingKRW, avgAcquisitionRate,
      monthlyInflowFx, fxPayableFx, quarterLossCapKRW, realizedLossThisQuarterKRW,
      policyMinRatio, policyMaxRatio,
      // 정책밴드 상한과 중복되는 고정 원화 노출 한도는 사용하지 않는다(레거시 필드).
      maxExposureKRW: 0,
    }
    const effective = source === 'simulation' && draft ? { ...live, ...draft } : live
    return {
      ...effective,
      source,
      updateInputs,
      resetSimulation,
      simulationDirty: source === 'simulation' && draft != null && Object.keys(draft).length > 0,
      saveOpsInput,
      ownerOf,
    }
  }, [totalFundKRW, fxHoldingFx, portfolioFxHoldingKRW, avgAcquisitionRate,
      monthlyInflowFx, fxPayableFx, quarterLossCapKRW, realizedLossThisQuarterKRW,
      policyMinRatio, policyMaxRatio, source, draft,
      updateInputs, resetSimulation, saveOpsInput])
}
