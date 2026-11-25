import { useCallback, useEffect, useState } from 'react'
import { restSelect, restInsert } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import { prevBizDay } from '../lib/bizDay'
import { computeReconcilePending, type ReconcileLot, type ReconcileConsumption } from '../lib/fxReconcile'
import type { Company, FxCode } from '../types'

/** 자금일보(daily) 잔액 증감 중 아직 원장(fx_lots)에 반영되지 않은 금액 1건 */
export interface PendingReconcileItem {
  dailyId: string
  date: string
  /** 이 델타가 나타내는 실제 거래일 (daily[X] 는 전영업일 마감이므로 X 의 전영업일) */
  txnDate: string
  direction: 'in' | 'out'
  /** 미반영 잔여 금액(외화 원금) — 원장에 이미 있는 그날 거래를 뺀 값 */
  amount: number
}

interface DailyRow { id: string; date: string; fx_usd: number; fx_eur: number; fx_jpy: number; fx_gbp: number; fx_cny: number }
interface IgnoredRow { daily_id: string }
interface TransferRow { id: string; transfer_date: string }

const FX_FIELD: Record<FxCode, keyof DailyRow> = {
  USD: 'fx_usd', EUR: 'fx_eur', JPY: 'fx_jpy', GBP: 'fx_gbp', CNY: 'fx_cny',
}

// daily 전 기간을 훑어 델타를 계산한다(경계일의 델타가 정확하려면 그 전날 값이 필요하므로).
// 표시 여부는 fromDate 로 나중에 걸러낸다.
const FETCH_LIMIT = 500

/**
 * 자금일보 ↔ 외화 원장 미반영 증감 조회.
 *
 * ⭐ 계산은 lib/fxReconcile.computeReconcilePending 이 한다 — 이 훅은 조회만 한다.
 *   (2026-11-25 전수조사 F-03) 과거 계산은 운전자금 잔액(daily.fx_*)을 원장 **전체**(정기예금 포함)
 *   거래와 비교하고 계좌 대체를 통째로 뺐다. 그래서 정기예금 만기·예치가 가짜 미반영으로 떴고,
 *   "반영"을 누르면 재고가 이중 계상되거나 실제로 소진됐다. 이제 원장 쪽도 **운전 계좌유형의
 *   순증감**만 비교한다(계좌 대체는 이 규칙으로 자동으로 맞는다).
 *
 * "존재 여부"가 아니라 **금액을 매번 재계산해서 비교**한다(daily 값을 나중에 정정해도
 * 미반영액이 자동으로 재조정됨 — 세션14차 "유령 평가손익 항목" 버그의 존재기반 dedup
 * 방식을 반복하지 않기 위한 설계).
 *
 * ⚠ 원장 개시 로트(source_type='opening')는 개시일 기준 그 이전 이력을 이미 흡수한
 * 잔고다. `fromDate` 로 개시일 이후만 보는 게 기본이지만, 경계 근처는 사용자가 직접
 * "무시"(fx_ledger_reconcile_ignored, docs/db/fx_ledger_reconcile_ignore.sql) 처리해
 * 목록에서 뺄 수 있다 — fx_lots/fx_lot_consumptions 는 건드리지 않는, 표시 전용 배제다.
 */
export function useFxLedgerReconciliation(company: Company, currency: FxCode, fromDate?: string) {
  const [items, setItems] = useState<PendingReconcileItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: dailyRows } = await restSelect<DailyRow>('daily', {
      match: { company }, order: 'date.desc', limit: FETCH_LIMIT,
    })
    const field = FX_FIELD[currency]
    const rows = (dailyRows ?? []).map(r => ({ id: r.id, date: r.date, value: Number(r[field] ?? 0) }))
    if (rows.length < 2) { setItems([]); setLoading(false); return }
    const earliest = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date)

    const [{ data: lots }, { data: cons }, { data: transfers }, { data: ignoredRows }] = await Promise.all([
      restSelect<ReconcileLot>('fx_lots', { match: { company, currency }, limit: 3000 }),
      restSelect<ReconcileConsumption>('fx_lot_consumptions', {
        match: { company, currency }, filters: [`disposed_date=gte.${earliest}`], limit: 5000,
      }),
      restSelect<TransferRow>('fx_lot_transfers', { match: { company, currency }, limit: 2000 }),
      restSelect<IgnoredRow>('fx_ledger_reconcile_ignored', { match: { company, currency }, limit: 2000 }),
    ])

    setItems(computeReconcilePending({
      daily: rows,
      lots: lots ?? [],
      consumptions: cons ?? [],
      transferDates: new Map((transfers ?? []).map(t => [t.id, t.transfer_date])),
      ignored: new Set((ignoredRows ?? []).map(r => r.daily_id)),
      fromDate,
      prevBizDay,
    }))
    setLoading(false)
  }, [company, currency, fromDate])

  useEffect(() => { void load() }, [load])

  /** 이 날짜의 증감을 "이미 개시 잔고 등으로 반영됨"으로 표시 — fx_lots 는 건드리지 않는다. */
  const dismiss = useCallback(async (item: PendingReconcileItem, userCode: string) => {
    const { error: err } = await restInsert('fx_ledger_reconcile_ignored', {
      id: generateUUID(), company, currency, daily_id: item.dailyId,
      direction: item.direction, amount: item.amount, ignored_by: userCode,
    })
    if (!err) await load()
    return err?.message ?? null
  }, [company, currency, load])

  return { items, loading, reload: load, dismiss }
}
