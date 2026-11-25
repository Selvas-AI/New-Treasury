/**
 * fxReconcile — 자금일보(운전자금 외화 잔액) ↔ 외화 원장 대사 (2026-11-25 전수조사 F-03)
 *
 * ⭐ 비교 기준을 맞춘다
 *   daily.fx_{통화} 는 **운전자금 외화(보통예금·MMDA)** 잔액이다. 정기예금(운용자금)은 들어 있지 않다.
 *   그런데 과거 대사는 원장의 **모든** 로트·소진을 그날 거래로 세고, 계좌 대체는 통째로 뺐다.
 *   → 정기예금 만기(정기예금 → 보통예금)는 daily 에선 +5M 인데 원장 쪽에선 0 으로 보여
 *     "미반영 유입 5M"이 떴고, 반영을 누르면 **같은 외화가 원장에 두 번** 생겼다.
 *     예치(보통예금 → 정기예금)는 반대로 가짜 유출이 떠, 반영하면 로트가 실제로 소진됐다.
 *
 *   이제 원장 쪽도 **운전 계좌유형의 순증감**만 센다:
 *     그날 운전 계좌에 생긴 로트(원금) − 그날 운전 계좌 로트에서 나간 소진
 *   계좌 대체는 이 규칙으로 자동으로 맞는다(정기예금 → 보통예금 대체는 보통예금 로트 생성(+),
 *   정기예금 쪽 소진은 운전이 아니라 집계에서 빠짐). 예외 규칙이 필요 없다.
 *
 * ⚠ 로트가 "생긴 날"은 취득일이 아니다. 계좌 대체(carryover) 로트는 FIFO 순서 보존을 위해
 *   **원본의 취득일을 승계**하므로, 생긴 날 = 대체일이다(available_from, 없으면 대체 이력의 날짜).
 *
 * ⚠ 날짜 구간 매칭 — daily[X] 는 전영업일 마감이므로 X 행의 증감은
 *   (prevBizDay(직전 행 날짜), prevBizDay(X)] 구간의 거래다. 자금일보를 하루 건너뛰면
 *   그 구간이 이틀이 되고, 원장의 이틀치 거래를 모두 차감해야 맞는다
 *   (과거엔 하루치만 차감해 가짜 미반영이 떴다).
 *
 * 개시 로트(opening)는 거래가 아니라 최초 재고 스냅샷이라 제외한다.
 */

/** 운전자금(daily.fx_*)에 해당하는 계좌유형 — 정기예금은 운용자금이라 제외 */
export const OPERATING_ACCOUNT_TYPES: readonly string[] = ['demand_deposit', 'mmda']

export interface ReconcileDailyRow { id: string; date: string; value: number }
export interface ReconcileLot {
  id: string
  account_type: string
  source_type: string
  acquired_date: string
  original_amount: number
  available_from?: string | null
  transfer_id?: string | null
}
export interface ReconcileConsumption { lot_id: string; disposed_date: string; amount: number }

export interface ReconcilePending {
  dailyId: string
  /** 자금일보 작성일(이 잔액이 기재된 행) */
  date: string
  /** 이 증감이 나타내는 거래일(구간의 끝) — 원장 반영 날짜 */
  txnDate: string
  /** 구간 시작(포함하지 않음). 자금일보를 건너뛴 날이 있으면 txnDate 보다 이틀 이상 앞선다 */
  fromExclusive: string
  direction: 'in' | 'out'
  amount: number
}

/** 로트가 장부에 생긴 날 — 대체 로트는 대체일(원본 취득일 승계 때문) */
export function lotCreatedDate(lot: ReconcileLot, transferDates: ReadonlyMap<string, string>): string {
  if (lot.available_from) return lot.available_from
  if (lot.transfer_id) return transferDates.get(lot.transfer_id) ?? lot.acquired_date
  return lot.acquired_date
}

export function computeReconcilePending(input: {
  /** 날짜 오름차순일 필요 없음 — 안에서 정렬한다 */
  daily: ReconcileDailyRow[]
  lots: ReconcileLot[]
  consumptions: ReconcileConsumption[]
  transferDates: ReadonlyMap<string, string>
  ignored: ReadonlySet<string>
  /** 이 날짜 이전(작성일 기준)은 표시하지 않는다 */
  fromDate?: string
  /** 전영업일 — 공휴일 달력은 화면 쪽(lib/bizDay)에 있다 */
  prevBizDay: (date: string) => string
  /** 이 금액(외화) 이하는 무시 — 소수점 반올림 잔차 */
  tolerance?: number
}): ReconcilePending[] {
  const tol = input.tolerance ?? 0.5
  const rows = [...input.daily].sort((a, b) => a.date.localeCompare(b.date))
  const isOp = (t: string) => OPERATING_ACCOUNT_TYPES.includes(t)
  const lotById = new Map(input.lots.map(l => [l.id, l]))

  // 날짜별 원장 운전 순증감
  const netByDate = new Map<string, number>()
  const add = (d: string, v: number) => netByDate.set(d, (netByDate.get(d) ?? 0) + v)
  for (const l of input.lots) {
    if (l.source_type === 'opening' || !isOp(l.account_type)) continue
    add(lotCreatedDate(l, input.transferDates), Number(l.original_amount))
  }
  for (const c of input.consumptions) {
    const l = lotById.get(c.lot_id)
    if (!l || !isOp(l.account_type)) continue
    add(c.disposed_date, -Number(c.amount))
  }
  const dates = [...netByDate.keys()].sort()
  const netBetween = (fromEx: string, toIn: string) =>
    dates.reduce((s, d) => (d > fromEx && d <= toIn ? s + (netByDate.get(d) ?? 0) : s), 0)

  const out: ReconcilePending[] = []
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i]
    if (input.fromDate && cur.date < input.fromDate) continue
    if (input.ignored.has(cur.id)) continue
    const delta = Number(cur.value ?? 0) - Number(rows[i - 1].value ?? 0)
    const txnDate = input.prevBizDay(cur.date)
    const fromExclusive = input.prevBizDay(rows[i - 1].date)
    const remain = delta - netBetween(fromExclusive, txnDate)
    if (Math.abs(remain) > tol) {
      out.push({ dailyId: cur.id, date: cur.date, txnDate, fromExclusive,
        direction: remain > 0 ? 'in' : 'out', amount: Math.abs(remain) })
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}
