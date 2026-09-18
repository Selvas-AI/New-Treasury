/**
 * 외화 정기예금 — 운용자금 처리에서 원장 해지 파라미터를 도출한다 (2026-09-15)
 *
 * ⭐ 왜 필요한가.
 *   정기예금은 **두 장부에 동시에 존재**한다.
 *     investments — 계약 조건(은행·금리·만기)과 만기 처리 여부의 정본
 *     fx_lots     — 외화 원가(장부환율)·FIFO 순서·환전 가능 여부의 정본
 *   그런데 실무자는 운용자금 화면에서만 만기·재예치를 처리한다(외화거래명세는 메뉴
 *   권한이 따로 있어 경로 자체가 없는 경우도 있다). 그 결과 원장에는 만기 지난
 *   정기예금이 그대로 남아 **환전 가능액이 과소 계산**되고, 두 장부가 조용히 벌어진다.
 *   → 운용자금 처리 한 번으로 원장까지 반영되게 한다. 이 파일은 그 변환만 담당하며
 *     DB 를 모른다 — 그래야 테스트로 검증할 수 있다.
 *
 * ⚠ 추정하지 않는다. 금액이 줄어드는 연장(일부만 재예치)은 줄어든 돈이 어디로 갔는지
 *   (보통예금 이체 / 매각 / 대외 지급) 알 수 없다. 그런 경우는 자동 반영을 거부하고
 *   원장에서 직접 기록하도록 안내한다.
 */
import type { FxAccountType, FxLot } from './fxLots'
import type { InvestmentRecord } from '../types'

const EPS = 0.000001

/** 계좌 대체 평가 방식 — 법인 정책(policy_params.fx_transfer_valuation) */
export type FxValuationMethod = 'carryover' | 'revalue'

export function parseValuationMethod(text: string | null | undefined): FxValuationMethod {
  return text === 'revalue' ? 'revalue' : 'carryover'
}

export interface ValuationInput {
  method: FxValuationMethod
  /** 재평가 정책일 때 적용할 대체환율(재예치일 매매기준율). carryover 면 무시된다 */
  transferRate?: number | null
}

/**
 * 재평가(revalue) 정책이면 대체환율이 **반드시** 있어야 한다.
 *
 * ⚠ 서버 `transfer_fx_lots` 는 `v_method='revalue' and p_transfer_rate<=0` 이면 거부한다.
 *   클라이언트가 이를 막지 않으면 사용자는 **운용자금 연장을 저장한 뒤에야** 원장 반영
 *   실패를 보게 된다(운용자금·원장이 벌어진 상태로 남는다). 저장 전에 차단한다.
 */
function valuationError(v: ValuationInput | undefined): string | null {
  if (!v || v.method !== 'revalue') return null
  if (!(Number(v.transferRate) > 0)) {
    return '재평가(revalue) 정책이므로 대체환율(재예치일 매매기준율)을 입력해야 원장에 반영할 수 있습니다.'
  }
  return null
}

export interface TermPrincipalRow {
  lotId: string
  acquiredDate: string
  maturityDate: string | null
  amount: number
  acqRate: number
}

/**
 * 해지 원금이 **어느 정기예금 로트에서 얼마씩** 빠지는지 미리 계산한다.
 *
 * ⚠ 서버 `transfer_fx_lots`(docs/db/fx_term_deposit_investment_link.sql)의 소진 순서와
 *   **반드시 같아야** 한다 — `만기 도래분 우선 → 그 안에서 취득일 FIFO → id`.
 *   순수 취득일 FIFO 로 미리 보여주면 중도해지(allowEarly)일 때 화면과 실제 결과가
 *   갈라진다(2026-09-15 서버 교정 사유와 동일한 함정).
 */
export function previewTermPrincipalConsumption(
  lots: FxLot[], principal: number, settleDate: string, allowEarly: boolean,
): TermPrincipalRow[] {
  const matured = (l: FxLot) => !!l.maturityDate && l.maturityDate <= settleDate
  const ordered = lots
    .filter(l => l.accountType === 'term_deposit' && l.remainingAmount > 0)
    .filter(l => allowEarly || matured(l))
    .sort((a, b) =>
      (matured(a) ? 0 : 1) - (matured(b) ? 0 : 1)
      || a.acquiredDate.localeCompare(b.acquiredDate)
      || a.id.localeCompare(b.id))

  let remaining = Math.max(0, principal)
  const rows: TermPrincipalRow[] = []
  for (const lot of ordered) {
    if (remaining <= EPS) break
    const amount = Math.min(remaining, lot.remainingAmount)
    rows.push({
      lotId: lot.id, acquiredDate: lot.acquiredDate,
      maturityDate: lot.maturityDate ?? null, amount, acqRate: lot.acqRate,
    })
    remaining -= amount
  }
  return rows
}

/**
 * 재평가 정책에서 이 해지로 확정되는 환차손익(원화).
 *   실현손익 = Σ 소진액 × (대체환율 − 장부환율)
 *
 * 원가승계(carryover)는 장부환율을 그대로 물려받으므로 **항상 0** 이다.
 */
export function revaluePnlKRW(rows: TermPrincipalRow[], transferRate: number): number {
  return rows.reduce((sum, r) => sum + r.amount * (transferRate - r.acqRate), 0)
}

export interface FxTermSettlePlan {
  /** 해지(대체)할 원금 — 기존 예금 금액 */
  principal: number
  /** 원금 행선지. 재예치면 term_deposit */
  toAccountType: FxAccountType
  /** 이자 수취액. 0 이면 이자 로트를 만들지 않는다 */
  interest: number
  /**
   * 이자 행선지.
   * ⚠ 연장으로 금액이 늘었다는 것은 **이자를 원금에 더해 다시 묶었다**는 뜻이므로
   *   이자도 정기예금으로 들어가야 한다. 보통예금으로 넣으면 원장 정기예금 잔액이
   *   이자만큼 운용자금보다 작아져 정합성 경고가 뜬다.
   */
  interestAccountType: FxAccountType
  maturityDate: string | null
  annualInterestRate: number
  /** 만기 도래분만으로 원금을 채우지 못하면 중도해지 */
  allowEarly: boolean
}

export interface LedgerTermState {
  /** 원장의 정기예금 잔액 합계 */
  termTotal: number
  /** 그중 해지일 기준 만기가 도래한 금액 */
  maturedTotal: number
}

export type PlanResult =
  | { plan: FxTermSettlePlan; warning: string | null }
  | { error: string }

export function isPlanError(r: PlanResult): r is { error: string } {
  return 'error' in r
}

/** 외화 정기예금인가 — 원장 연동 대상 판별 */
export function isFxTermDeposit(rec: InvestmentRecord): boolean {
  return rec.product === '정기예금' && !!rec.currency && rec.currency !== 'KRW'
}

/** 해지일 기준 원장 정기예금 상태를 집계한다(화면·계획 양쪽이 같은 값을 쓰도록 SSOT). */
export function termStateAt(lots: FxLot[], settleDate: string): LedgerTermState {
  const term = lots.filter(l => l.accountType === 'term_deposit' && l.remainingAmount > 0)
  return {
    termTotal: term.reduce((s, l) => s + l.remainingAmount, 0),
    maturedTotal: term
      .filter(l => !!l.maturityDate && l.maturityDate <= settleDate)
      .reduce((s, l) => s + l.remainingAmount, 0),
  }
}

/** 원장 잔액이 해지 원금을 감당하는지 — 감당 못 하면 반영 자체가 실패하므로 미리 막는다. */
function coverage(principal: number, st: LedgerTermState): string | null {
  if (principal > st.termTotal + EPS) {
    return `원장 정기예금 잔액(${st.termTotal.toLocaleString()})이 해지 원금(${principal.toLocaleString()})보다 적습니다. `
      + '두 장부가 이미 벌어져 있으니 외화거래명세 › 데이터 등록에서 먼저 맞추세요.'
  }
  return null
}

/**
 * 연장(rollover) → 원장 해지·재예치 계획.
 *
 * 원금은 기존 금액 그대로 정기예금 → 정기예금 대체(원가승계, 손익 0),
 * 늘어난 금액은 이자 재예치로 보아 **해지일 환율의 신규 로트**로 넣는다.
 */
export function planRolloverLedger(
  record: InvestmentRecord,
  v: { closeDate: string; newMaturity: string; newAmount: number; newRate: number },
  st: LedgerTermState,
  valuation?: ValuationInput,
): PlanResult {
  const principal = record.amount ?? 0
  if (!(principal > 0)) return { error: '기존 예금 금액이 없어 원장에 반영할 수 없습니다.' }
  if (!v.newMaturity) return { error: '새 만기일이 있어야 원장 재예치를 만들 수 있습니다.' }
  const vErr = valuationError(valuation)
  if (vErr) return { error: vErr }

  const interest = v.newAmount - principal
  if (interest < -EPS) {
    return {
      error: '연장 금액이 기존보다 적습니다. 줄어든 금액이 어디로 갔는지(보통예금 이체·매각·지급)는 '
        + '시스템이 알 수 없으므로 자동 반영하지 않습니다. 외화거래명세에서 직접 기록하세요.',
    }
  }

  return {
    plan: {
      principal,
      toAccountType: 'term_deposit',
      interest: interest > EPS ? interest : 0,
      interestAccountType: 'term_deposit',   // 이자를 더해 다시 묶은 것이므로
      maturityDate: v.newMaturity,
      annualInterestRate: v.newRate,
      allowEarly: principal > st.maturedTotal + EPS,
    },
    warning: coverage(principal, st),
  }
}

/**
 * 만기처리(해지) → 원장 해지 계획. 재예치가 아니므로 원금은 수시입출 계좌로 나온다.
 * 이자는 사용자가 입력한 만큼만 신규 로트로 잡는다(모르면 0 — 추정하지 않는다).
 */
export function planCloseLedger(
  record: InvestmentRecord,
  opts: { closeDate: string; toAccountType: FxAccountType; interest: number },
  st: LedgerTermState,
  valuation?: ValuationInput,
): PlanResult {
  const principal = record.amount ?? 0
  if (!(principal > 0)) return { error: '기존 예금 금액이 없어 원장에 반영할 수 없습니다.' }
  const vErr = valuationError(valuation)
  if (vErr) return { error: vErr }
  if (opts.toAccountType === 'term_deposit') {
    return { error: '만기처리의 행선지는 정기예금이 될 수 없습니다. 재예치라면 연장을 사용하세요.' }
  }
  if (opts.interest < 0) return { error: '이자는 음수가 될 수 없습니다.' }

  return {
    plan: {
      principal,
      toAccountType: opts.toAccountType,
      interest: opts.interest > EPS ? opts.interest : 0,
      interestAccountType: opts.toAccountType,
      maturityDate: null,
      annualInterestRate: 0,
      allowEarly: principal > st.maturedTotal + EPS,
    },
    warning: coverage(principal, st),
  }
}
