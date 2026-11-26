/**
 * fxReportItemLedger — 자금일보 외화 항목 → 외화거래명세(원장) 반영 규칙 (2026-11-25)
 *
 * ⭐ 실무 리포트: 같은 외화 거래를 자금일보에 한 번, 외화거래명세에 환율과 함께 또 한 번
 *   입력하고 있었다. 기존 "자금일보 미반영 증감" 패널은 **일자별 잔액 차이**에 환율 하나만 받아
 *   ① 같은 날 장부환율이 다른 출금 여러 건이 한 환율로 합쳐졌고
 *   ② 잔액 차이라 입력한 항목 금액과 달라 보였다(EUR 85,996 vs 입력 87,823).
 *   → 항목에 환율을 함께 입력하면 **그 항목 그대로** 원장에 반영한다.
 *
 * ⚠ 이 규칙은 서버 RPC(docs/db/fx_report_item_ledger.sql 의 sync_report_item_ledger)와
 *   **반드시 같아야 한다.** 화면이 "반영됨"이라 말하는데 서버가 건너뛰면(또는 그 반대)
 *   원장과 자금일보가 조용히 갈라진다. 한쪽을 바꾸면 다른 쪽도 바꿀 것.
 */
import { availableAmount, previewFifoConsumption, type FxLot } from './fxLots'

/**
 * 원장에 반영하지 않는 카테고리와 이유.
 * · 투자자산평가 — 평가손익은 현금 이동이 아니다(자동기재 항목).
 * · 투자 집행 / 투자금 회수 — 외화 정기예금 가입·해지는 **운용자금 처리 때** 원장에
 *   계좌 대체로 이미 반영된다. 여기서 또 반영하면 같은 외화가 두 번 움직인다.
 */
export const NON_LEDGER_CATEGORIES: Readonly<Record<string, string>> = {
  invest_eval_in:  '평가손익은 현금 이동이 아니라 원장에 반영하지 않습니다',
  invest_eval_out: '평가손익은 현금 이동이 아니라 원장에 반영하지 않습니다',
  invest_execute:  '외화 정기예금 가입은 운용자금 처리 때 원장에 반영됩니다',
  invest_return:   '외화 정기예금 해지는 운용자금 처리 때 원장에 반영됩니다',
}

/** 이 항목이 원장 반영 대상인가 (환율 입력 여부와 무관) */
export function isLedgerCategory(item: { currency: string; category: string }): boolean {
  return item.currency !== 'KRW' && !(item.category in NON_LEDGER_CATEGORIES)
}

/**
 * 반영 대상이지만 **중복 위험**이 있어 화면에서 미리 알려줄 카테고리.
 * 정기예금 해지 이자는 운용자금 처리 때 이자 로트가 이미 생긴다 — 그 경우 환율을 비워 둔다.
 */
export const DUPLICATE_RISK_HINT: Readonly<Record<string, string>> = {
  interest_income: '외화 정기예금 해지 이자는 운용자금 처리 때 이미 원장에 반영됩니다 — 그 이자라면 환율을 비워 두세요',
}

export type ReportItemLedgerState =
  | 'not_applicable'   // 원화·평가손익·정기예금 연동 — 원장과 무관
  | 'reflected'        // 원장에 반영됨
  | 'missing_rate'     // 반영 대상인데 환율이 없다
  | 'pending'          // 환율은 있는데 원장에서 찾지 못함(반영 실패·SQL 미적용)

export function reportItemLedgerState(
  item: { id: string; currency: string; category: string; fx_rate?: number | null },
  reflectedIds: ReadonlySet<string>,
): ReportItemLedgerState {
  if (!isLedgerCategory(item)) return 'not_applicable'
  if (reflectedIds.has(item.id)) return 'reflected'
  if (!(item.fx_rate != null && item.fx_rate > 0)) return 'missing_rate'
  return 'pending'
}

/** 서버 함수가 아직 없을 때(SQL 미적용)의 오류인가 — 화면이 원인을 정확히 안내하게 */
export function isLedgerRpcMissing(message: string | null | undefined): boolean {
  if (!message) return false
  return /sync_report_item_ledger|Could not find the function|PGRST202/i.test(message)
}

// ── 계좌구분 (2026-11-26 · docs/db/fx_report_item_account.sql) ──────────────
//   입금 → 고른 계좌유형의 로트(장부환율 = 입력 환율)
//   출금 → 고른 계좌유형의 로트만 FIFO 소진. 장부환율은 원장 로트가 정하고,
//          입력 환율은 적용환율(결제일 환율) — 환차손익 = 금액 × (적용 − 장부)
//   미지정(기존 항목) → 기존 방식(입금 보통예금 · 출금 우선순위 FIFO). 신규 반영은 필수.

export type ReportItemFxAccount = 'demand_deposit' | 'mmda'
export const REPORT_ITEM_FX_ACCOUNTS: readonly ReportItemFxAccount[] = ['demand_deposit', 'mmda']
export const REPORT_ITEM_FX_ACCOUNT_LABEL: Readonly<Record<ReportItemFxAccount, string>> = {
  demand_deposit: '보통예금',
  mmda: 'MMDA',
}

export function isReportItemFxAccount(v: unknown): v is ReportItemFxAccount {
  return v === 'demand_deposit' || v === 'mmda'
}

/** 환율 입력칸 이름 — 입금은 그 환율이 장부환율, 출금은 적용(결제)환율 */
export function reportItemRateLabel(direction: 'in' | 'out'): string {
  return direction === 'in' ? '장부환율' : '적용환율'
}

export interface OutflowPreview {
  /** 거래일 기준 그 계좌에서 꺼낼 수 있는 잔액 */
  available: number
  /** 부족분(0 이면 충분) */
  shortfall: number
  /** 이 출금이 소진할 로트들의 수량가중 장부환율 (소진량 0 이면 null) */
  bookRate: number | null
  /** 적용환율이 있으면 예상 환차손익(원) */
  pnlKRW: number | null
}

/**
 * 출금 항목 미리보기 — 서버 sync_report_item_ledger 와 같은 규칙:
 * 그 계좌유형 로트 중 거래일에 이미 장부에 있던 것(isLotAvailable)을 취득일 순 FIFO 로 소진한다.
 * ⚠ 미리보기다 — 저장 사이 다른 출금이 먼저 반영되면 실제 소진 로트가 달라질 수 있다(서버 결과가 정본).
 */
export function previewReportItemOutflow(
  lots: readonly FxLot[],
  account: ReportItemFxAccount,
  amount: number,
  txnDate: string,
  applyRate: number | null,
): OutflowPreview {
  const pool = lots.filter(l => l.accountType === account)
  const available = availableAmount(pool, txnDate)
  const take = Math.max(0, Math.min(amount, available))
  const rows = take > 0 ? previewFifoConsumption([...pool], take, applyRate ?? 1, txnDate) : []
  const qty = rows.reduce((t, r) => t + r.amount, 0)
  const cost = rows.reduce((t, r) => t + r.amount * r.acqRate, 0)
  const bookRate = qty > 0 ? cost / qty : null
  return {
    available,
    shortfall: Math.max(0, amount - available),
    bookRate,
    pnlKRW: applyRate != null && applyRate > 0 && bookRate != null ? qty * (applyRate - bookRate) : null,
  }
}
