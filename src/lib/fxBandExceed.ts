/**
 * 정책 밴드 상한 대비 외화 보유 초과분 산출 (세션26차 11일차).
 *
 * ⭐ 왜 σ×Z 한도 모델이 아니라 정책 밴드(fx_target_min/max)를 쓰는가:
 *   세션26차 리짐 채택 이후 구조는 "한도(밴드)는 리스크 모델이 만들고, 시점과 금액은
 *   리짐이 정한다"이다. σ×Z 실효한도는 밴드를 **만들어내는 계산기**(자금정책 ③ 탭)일
 *   뿐이고, 실제로 의결돼 시스템에 박힌 제약은 `fx_target_max` 다.
 *   실무 화면이 계산기 모델을 다시 구현하면 두 화면이 서로 다른 상한을 말하게 된다
 *   — 세션19차에 같은 값(외화비중)이 6.2%/27.9%로 갈라졌던 사고와 같은 구조다.
 *
 * 분자·분모는 반드시 usePolicyDashboard(SSOT)의 값을 그대로 받는다. 여기서 재계산하지 말 것.
 */
import { addBizDays, todayStr } from './bizDay'
import { fmtKRW } from './format'
import type { FxCode, Company } from '../types'

export interface FxBandExceedRow {
  code: FxCode
  nativeAmount: number
  krwAmount: number
  /** 전사 외화 바구니 안에서 이 통화가 차지하는 비중(%) */
  sharePct: number
  /** sharePct 기준으로 안분한 이 통화의 초과분(KRW) */
  excessKRW: number
}

export interface FxBandExceedResult {
  /** 정책 밴드가 설정돼 있지 않으면 판정 불가 */
  configured: boolean
  ratio: number
  min: number | null
  max: number | null
  holdingsKRW: number
  denominatorKRW: number
  /** 밴드 상한에 해당하는 원화 금액 */
  ceilingKRW: number
  /** 상한 초과분(KRW). 초과가 아니면 0 */
  excessKRW: number
  over: boolean
  rows: FxBandExceedRow[]
}

export function computeFxBandExceed(
  data: {
    fxRatio: number
    fxPortfolioHoldings: number
    fxPolicyDenominator: number
    fxByCurrency: Record<string, { nativeAmount: number; krwAmount: number }>
  },
  params: { get: (key: string) => number | null },
): FxBandExceedResult {
  const min = params.get('fx_target_min')
  const max = params.get('fx_target_max')
  const holdingsKRW = data.fxPortfolioHoldings
  const denominatorKRW = data.fxPolicyDenominator
  const ceilingKRW = max != null ? denominatorKRW * (max / 100) : 0
  const excessKRW = max != null ? Math.max(0, holdingsKRW - ceilingKRW) : 0

  const rows: FxBandExceedRow[] = Object.entries(data.fxByCurrency)
    .map(([code, v]) => {
      const sharePct = holdingsKRW > 0 ? (v.krwAmount / holdingsKRW) * 100 : 0
      return {
        code: code as FxCode,
        nativeAmount: v.nativeAmount,
        krwAmount: v.krwAmount,
        sharePct,
        // 통화별 목표 비중이 의결돼 있지 않으므로, 초과분은 현재 보유 구성비대로 안분한다
        // (특정 통화만 팔라는 지시가 아니라 "얼마를 줄여야 하는가"의 통화별 배분 참고치).
        excessKRW: excessKRW * (sharePct / 100),
      }
    })
    .filter(r => r.krwAmount > 0)
    .sort((a, b) => b.krwAmount - a.krwAmount)

  return {
    configured: max != null,
    ratio: data.fxRatio,
    min, max, holdingsKRW, denominatorKRW, ceilingKRW, excessKRW,
    over: max != null && excessKRW > 0,
    rows,
  }
}

/**
 * 상한 초과 매도 발의 payload — `useFxTradeHistory().propose()` 에 그대로 넘긴다.
 *
 * 자금정책 화면의 기존 발의와 **동일한 컬럼 규약**을 쓴다(order_type='threshold',
 * due_date=등록일+3영업일). 발의 경로가 늘어도 이행 관리·대시보드 경보·D-day 계산이
 * 전부 같은 규칙으로 동작해야 하므로 payload 조립은 이 함수 하나로만 한다.
 */
export function buildThresholdOrderPayload(input: {
  company: Company
  currency: FxCode
  amountFx: number
  /** 매도 예정 환율 (현재 시장환율) */
  rate: number
  /** FIFO 잔존 장부환율 — 없으면 예상 손익을 계산하지 않는다 */
  acqRate: number | null
  excessKRW: number
  createdBy: string
  /** 발의가 일어난 화면 — 사후 추적용으로 메모에 남긴다 */
  origin: string
}) {
  const today = todayStr()
  return {
    company: input.company,
    trade_date: addBizDays(today, 3),
    currency: input.currency,
    direction: 'sell' as const,
    amount_fx: input.amountFx,
    acq_rate: input.acqRate,
    trade_rate: input.rate,
    fx_pnl: input.acqRate != null ? Math.round((input.rate - input.acqRate) * input.amountFx) : null,
    amount_krw: Math.round(input.rate * input.amountFx),
    memo: `정책 밴드 상한 초과 — 초과분 ${fmtKRW(input.excessKRW)} 원화 전환 발의 (${input.origin})`,
    created_by: input.createdBy,
    due_date: addBizDays(today, 3),
    order_type: 'threshold' as const,
  }
}
