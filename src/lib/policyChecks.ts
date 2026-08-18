/**
 * policyChecks — 정책 지표 적합성 판정 (SSOT)
 *
 * PolicyPage.tsx의 카드/매트릭스/다이제스트가 쓰던 checkLiquidity/checkFx/checkLoan/
 * checkConcentration을 공용 모듈로 분리 (세션20차 정책 이행 통제 Phase 1).
 * 대시보드(useDashboard.ts)에서도 동일 기준으로 "의결사항 위반 여부"를 판단해야 하므로,
 * PolicyPage 전용 파일 안에 갇혀 있던 로직을 재사용 가능하게 뺐다.
 */
import type { PolicyRealData } from '../hooks/usePolicyDashboard'
import type { PolicyParamReader } from '../hooks/usePolicyParams'
import type { PolicyLinkedMetric } from '../types'

export type StatusLevel = 'ok' | 'warn' | 'over' | 'na'
export const CONCENTRATION_LIMIT = 30

export function checkLiquidity(data: PolicyRealData, params: PolicyParamReader) {
  const fixedCost = params.get('liquidity_fixed_cost_monthly') ?? 0
  const minMonths = params.get('liquidity_min_months') ?? 2
  const target = fixedCost * minMonths
  const current = data.operatingCash
  const status: StatusLevel = target === 0 ? 'na'
    : current >= target ? 'ok'
    : current >= target * 0.8 ? 'warn'
    : 'over'
  return { status, current, target, ratio: target > 0 ? (current / target) * 100 : null }
}

export function checkFx(data: PolicyRealData, params: PolicyParamReader) {
  const min = params.get('fx_target_min')
  const max = params.get('fx_target_max')
  const ratio = data.fxRatio
  const status: StatusLevel = min === null || max === null ? 'na'
    : ratio >= min && ratio <= max ? 'ok'
    : ratio < min * 0.9 || ratio > max * 1.1 ? 'over'
    : 'warn'
  return { status, ratio, min, max, fxKrw: data.fxPortfolioHoldings, totalFund: data.fxPolicyDenominator }
}

export function checkLoan(data: PolicyRealData, params: PolicyParamReader) {
  const totalFund = params.get('fx_total_fund') ?? data.totalFundEstimate
  const max = params.get('loan_max_total_ratio')
  const ratio = totalFund > 0 ? (data.totalLoan / totalFund) * 100 : 0
  const status: StatusLevel = max === null ? 'na'
    : ratio <= max ? 'ok'
    : ratio <= max * 1.1 ? 'warn'
    : 'over'
  return { status, ratio, max, totalLoan: data.totalLoan, totalFund }
}

export function checkConcentration(data: PolicyRealData) {
  const total = data.investByBank.reduce((s, b) => s + b.amount, 0)
  if (total === 0) return { status: 'na' as StatusLevel, maxPct: 0, bank: null as string | null, total: 0 }
  let maxPct = 0, bank: string | null = null
  for (const b of data.investByBank) {
    const pct = (b.amount / total) * 100
    if (pct > maxPct) { maxPct = pct; bank = b.bank }
  }
  const status: StatusLevel = maxPct > CONCENTRATION_LIMIT ? 'over'
    : maxPct > CONCENTRATION_LIMIT * 0.9 ? 'warn' : 'ok'
  return { status, maxPct, bank, total }
}

/**
 * 리짐 목표 대비 초과 보유 폭 (%p) — 세션26차 Phase 4
 *
 * `checkFx` 는 **정책 밴드 준수**를 본다(밴드 안에 있는가).
 * 이 함수는 **리짐 목표 이행**을 본다(오늘 국면이 지시한 목표까지 줄였는가).
 * 둘은 다른 위반이다 — 밴드 안이어도 리짐 목표를 초과 보유할 수 있다.
 *
 * ⚠ 실시간 판정이 아니라 실무 화면이 남긴 스냅샷을 읽는다(fxRegimeSnapshot).
 *   대시보드에서 환율 이력 전체를 돌릴 수 없기 때문. 스냅샷이 없으면 'na'.
 */
export function checkFxRegimeTarget(snap: {
  targetPct: number | null; currentPct: number | null; suggestKRW: number; asOf: string | null
} | null) {
  if (!snap || snap.targetPct == null || snap.currentPct == null) {
    return { status: 'na' as StatusLevel, gapPct: null as number | null, suggestKRW: 0, asOf: null as string | null }
  }
  const gapPct = snap.currentPct - snap.targetPct       // 양수 = 목표보다 많이 들고 있음
  const status: StatusLevel = snap.suggestKRW <= 0 ? 'ok'
    : gapPct > 5 ? 'over'
    : 'warn'
  return { status, gapPct, suggestKRW: snap.suggestKRW, asOf: snap.asOf }
}

/** 의결사항의 linked_metric/target_operator/target_value 규칙을 현재 실측값과 비교 */
export function checkDecisionRule(
  linkedMetric: PolicyLinkedMetric,
  targetOperator: 'lte' | 'gte',
  targetValue: number,
  data: PolicyRealData,
  params: PolicyParamReader,
  /** fx_regime_gap 판정에 필요한 통화별 스냅샷 (없으면 위반 없음으로 본다) */
  regimeSnapshots?: { currency: string; targetPct: number | null; currentPct: number | null; suggestKRW: number }[],
): { violated: boolean; current: number; label: string } {
  let current: number
  let label: string
  if (linkedMetric === 'fx_ratio') {
    current = checkFx(data, params).ratio
    label = 'FX 비중'
  } else if (linkedMetric === 'loan_ratio') {
    current = checkLoan(data, params).ratio
    label = '차입 비율'
  } else if (linkedMetric === 'fx_regime_gap') {
    // 통화가 여럿이면 **가장 큰 초과 폭**으로 판정한다 — 한 통화라도 목표를 크게
    // 넘고 있으면 의결 미이행이기 때문.
    const gaps = (regimeSnapshots ?? [])
      .filter(s => s.targetPct != null && s.currentPct != null)
      .map(s => (s.currentPct as number) - (s.targetPct as number))
    current = gaps.length ? Math.max(...gaps) : 0
    label = '리짐 목표 대비 초과 보유(%p)'
  } else {
    current = data.operatingCash
    label = '유동성(원화 현금성)'
  }
  const violated = targetOperator === 'lte' ? current > targetValue : current < targetValue
  return { violated, current, label }
}
