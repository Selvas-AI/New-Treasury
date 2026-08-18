/**
 * cashflowFxDerive — 주간예측(12주 롤링)에서 리짐 운영 가정을 산출
 *
 * 세션26차. 근거: docs/기획/FX리짐_정책이관_계획.md §9
 *
 * 정책회의가 손으로 넣던 두 값을 실제 자금 계획에서 도출한다.
 *   월 외화 유입 가정   = 향후 12주 해당 통화 유입 합계 ÷ 3 (개월 환산)
 *   향후 3개월 결제 버퍼 = 향후 13주 해당 통화 유출 합계
 *
 * ⚠ 이 함수는 **참고안만 만든다**. 확정은 정책 기준 탭에서 사람이 저장한다 —
 *   한도 계산기의 권고 밴드와 같은 원칙(계산은 도구, 확정은 의결).
 *
 * ⚠ 금액은 **외화 원금**이다. cashflow_plan_items.currency 가 'KRW' 인 행은 제외한다.
 */

export interface PlanItemLike {
  week_start: string
  direction:  'in' | 'out'
  amount:     number
  currency?:  string
}

export interface DerivedOps {
  currency:        string
  /** 월 외화 유입 가정 (외화 원금) */
  monthlyInflowFx: number
  /** 향후 3개월 결제 버퍼 (외화 원금) */
  fxPayableFx:     number
  /** 산출에 쓰인 항목 수 — 0 이면 계획이 없다는 뜻이라 화면에서 구분해야 한다 */
  itemCount:       number
}

/** 유입 평균을 낼 개월 수 — 12주 ≈ 3개월 */
const INFLOW_MONTHS = 3
/** 결제 버퍼로 볼 주 수 — 3개월을 영업 관행상 13주로 본다 */
const PAYABLE_WEEKS = 13

/**
 * @param items      cashflow_plan_items (해당 법인 전체)
 * @param fromWeek   기준 주(월요일, YYYY-MM-DD). 이 주부터 앞으로 세어 나간다
 * @param currencies 산출 대상 통화
 */
export function deriveRegimeOpsFromPlan(
  items: PlanItemLike[],
  fromWeek: string,
  currencies: readonly string[],
): DerivedOps[] {
  // 주차는 문자열 비교로 정렬 가능한 ISO 날짜다. fromWeek 이후 주만 본다.
  const future = items.filter(i => i.week_start >= fromWeek)
  // 유출 기준 주 상한 — fromWeek 포함 13주차의 월요일
  const payableCutoff = addWeeks(fromWeek, PAYABLE_WEEKS)

  return currencies.map(code => {
    const rows = future.filter(i => (i.currency ?? 'KRW').toUpperCase() === code.toUpperCase())
    const inflow = rows
      .filter(i => i.direction === 'in')
      .reduce((s, i) => s + (i.amount || 0), 0)
    const payable = rows
      .filter(i => i.direction === 'out' && i.week_start < payableCutoff)
      .reduce((s, i) => s + (i.amount || 0), 0)
    return {
      currency: code,
      monthlyInflowFx: Math.round((inflow / INFLOW_MONTHS) * 100) / 100,
      fxPayableFx:     Math.round(payable * 100) / 100,
      itemCount:       rows.length,
    }
  })
}

/**
 * YYYY-MM-DD 에 n주 더한 날짜.
 *
 * ⚠ UTC 로 계산한다. `new Date('2026-08-10T00:00:00')` 는 **로컬 자정**이라
 *   toISOString() 이 KST(+9) 기준 전날(2026-08-09)을 내놓는다 —
 *   그러면 기준 주 자체가 "과거"로 걸러져 유입이 통째로 빠진다(테스트로 잡음).
 */
export function addWeeks(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d + n * 7)
  return new Date(t).toISOString().slice(0, 10)
}
