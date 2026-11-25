/**
 * fxQuarterLoss — 이번 분기 기실현 손실 (2026-11-25 전수조사 F-08)
 *
 * ⚠ 과거엔 "이번 분기 실현 손실"이 **수동 입력 1개 값**이고 분기 구분이 없었다.
 *   3분기에 넣은 값이 4분기에도 그대로 한도를 깎았다(누군가 0 으로 지우기 전까지 영구).
 *   원장에는 체결마다 실현손익이 이미 기록돼 있는데 연결돼 있지 않았다.
 *   → 원장(fx_lot_consumptions)에서 **이번 분기(KST)** 실현손익을 직접 계산한다.
 *     원장에 없는 손실만 분기별 키(fx_ops_loss_adjust_{yyyy}q{n})로 보정 입력한다.
 *
 * 집계 대상 거래 유형 — 기본 'sale'(원화 환전)만.
 *   재평가(revalue) 대체로 확정된 손실은 넣지 않는다(지침서 결정 D3 기본값):
 *   한도는 "매각 시점을 분산"하는 장치이고, 대체 손실은 회계정책의 결과라 시점을 고를 수 없다.
 *   대외 지급(payment)도 매각이 아니라 제외. includeTypes 로 바꿀 수 있다.
 */

export interface QuarterInfo { key: string; start: string; end: string }

/** 분기 — 날짜 문자열(YYYY-MM-DD, KST 로컬) 기준 */
export function quarterOf(date: string): QuarterInfo {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const q = Math.floor((m - 1) / 3) + 1
  const sm = (q - 1) * 3 + 1
  const em = sm + 2
  const lastDay = new Date(Date.UTC(y, em, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { key: `${y}q${q}`, start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(lastDay)}` }
}

export interface QuarterConsumptionRow {
  disposed_date: string
  realized_pnl: number | null
  txn_type?: string | null
}

/**
 * 이번 분기 실현 손실(원, 양수). 분기 실현손익 **합계가 손실일 때** 그 크기.
 * 같은 분기 안의 이익과 손실은 상계한다 — 한도는 "분기에 인식하는 손실"을 제한하는 것이므로.
 */
export function quarterRealizedLossKRW(
  rows: readonly QuarterConsumptionRow[],
  today: string,
  includeTypes: readonly string[] = ['sale'],
): { quarter: QuarterInfo; netPnlKRW: number; lossKRW: number; count: number } {
  const quarter = quarterOf(today)
  let net = 0
  let count = 0
  for (const r of rows) {
    if (r.disposed_date < quarter.start || r.disposed_date > quarter.end) continue
    if (!includeTypes.includes(r.txn_type ?? 'payment')) continue
    net += Number(r.realized_pnl ?? 0)
    count++
  }
  return { quarter, netPnlKRW: net, lossKRW: Math.max(0, -net), count }
}
