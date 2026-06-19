/**
 * treasuryCalc — 자금 집계 단일 진실원천(SSOT)
 *
 * 배경: 운전자금 원화합계·외화환산·국채평가 같은 "값 계산 프리미티브"가
 *   useDashboard / useDailyReportSummary / ReportSummaryTable / DailyReportPage 등
 *   여러 곳에 복제되어 있어, 한쪽만 바뀌면 대시보드 가용자금과 자금일보 총합계가
 *   어긋났다(특히 운전자금 외화: 저장값 fx_krw vs 현재환율 재계산 혼용).
 *
 * 원칙:
 *   - 모든 잔액/자산 집계는 본 모듈의 함수를 통해서만 계산한다.
 *   - 운전자금 원화합계는 항상 저장값 fx_krw 기준(= 입력 시점 환율 고정)으로 통일한다.
 *     → 대시보드와 자금일보가 동일 공식을 사용해 "총합계 = 가용자금 합계" 보장.
 *   - 함수는 순수(부수효과 없음). 구조적 타입으로 받아 Investment/Equity 변형들과 호환.
 */
import { calcBondValue } from './format'

export type FxCode = 'USD' | 'EUR' | 'JPY' | 'GBP' | 'CNY'
export type ToKRWFn = (amount: number, code: FxCode) => number

/** 외화 금액 → 원화 환산 (KRW 또는 통화 미지정이면 그대로) */
export function toKRWAmount(amount: number, currency: string | null | undefined, toKRW: ToKRWFn): number {
  if (!currency || currency === 'KRW') return amount
  return toKRW(amount, currency as FxCode)
}

export interface OpCashFields {
  krw_demand?: number | null
  krw_govt?:   number | null
  krw_mmda?:   number | null
  fx_krw?:     number | null
}

/**
 * 운전자금(현금성) 원화 합계 — 저장된 fx_krw 사용.
 * fx_krw = InputPage 저장 시 그날 환율로 계산된 외화 원화환산 합계(고정값).
 * 대시보드·자금일보가 모두 이 함수를 쓰므로 두 화면 수치가 일치한다.
 */
export function opCashKRW(d: OpCashFields | null | undefined): number {
  if (!d) return 0
  return (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)
}

export interface BondLikeFields {
  bondQty?:   number | null
  bondPrice?: number | null
  amount?:    number | null
}

/** 국채 평가액 — bondQty×(bondPrice/10). 수량/단가 없으면 amount(취득원금) 폴백 */
export function bondValueOf(i: BondLikeFields): number {
  return (i.bondQty && i.bondPrice) ? calcBondValue(i.bondQty, i.bondPrice) : (i.amount || 0)
}

export interface InvestLikeFields extends BondLikeFields {
  product?:  string | null
  currency?: string | null
}

/** 운용자금 단일 레코드의 평가액(원화) — 국채는 bondValueOf, 그 외 외화환산 */
export function investValueKRW(i: InvestLikeFields, toKRW: ToKRWFn): number {
  if (i.product === '국채') return bondValueOf(i)
  return toKRWAmount(i.amount || 0, i.currency, toKRW)
}
