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
