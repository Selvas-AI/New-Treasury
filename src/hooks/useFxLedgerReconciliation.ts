import { useCallback, useEffect, useState } from 'react'
import { restSelect, restInsert } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { Company, FxCode } from '../types'

/** 자금일보(daily) 잔액 증감 중 아직 원장(fx_lots)에 반영되지 않은 금액 1건 */
export interface PendingReconcileItem {
  dailyId: string
  date: string
  direction: 'in' | 'out'
  /** 미반영 잔여 금액(외화 원금) — 이미 일부 반영됐으면 그만큼 뺀 값 */
  amount: number
}

interface DailyRow { id: string; date: string; fx_usd: number; fx_eur: number; fx_jpy: number; fx_gbp: number; fx_cny: number }
interface LotSourceRow { source_id: string; original_amount: number }
interface ConsumptionSourceRow { source_id: string; amount: number }
interface IgnoredRow { daily_id: string }

const FX_FIELD: Record<FxCode, keyof DailyRow> = {
  USD: 'fx_usd', EUR: 'fx_eur', JPY: 'fx_jpy', GBP: 'fx_gbp', CNY: 'fx_cny',
}

// daily 전 기간을 훑어 델타를 계산한다(경계일의 델타가 정확하려면 그 전날 값이 필요하므로).
// 표시 여부는 fromDate 로 나중에 걸러낸다.
const FETCH_LIMIT = 500

/**
 * 자금일보 ↔ 외화 원장 자동 반영 대상 조회.
 *
 * "존재 여부"가 아니라 **금액을 매번 재계산해서 비교**한다(daily 값을 나중에 정정해도
 * 미반영액이 자동으로 재조정됨 — 세션14차 "유령 평가손익 항목" 버그의 존재기반 dedup
 * 방식을 반복하지 않기 위한 설계).
 *
 * 미반영액 = |오늘잔액 − 전일잔액| − (source_type='daily_report_item' 로 이미 반영된 금액)
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
    const rows = (dailyRows ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
    const field = FX_FIELD[currency]
    const deltas: { dailyId: string; date: string; delta: number }[] = []
    for (let i = 1; i < rows.length; i++) {
      if (fromDate && rows[i].date < fromDate) continue
      const delta = Number(rows[i][field] ?? 0) - Number(rows[i - 1][field] ?? 0)
      if (Math.abs(delta) > 0.000001) deltas.push({ dailyId: rows[i].id, date: rows[i].date, delta })
    }
    if (!deltas.length) { setItems([]); setLoading(false); return }

    const ids = deltas.map(d => d.dailyId)
    const [{ data: lotRows }, { data: consRows }, { data: ignoredRows }] = await Promise.all([
      restSelect<LotSourceRow>('fx_lots', {
        match: { company, currency, source_type: 'daily_report_item' },
        filters: [`source_id=in.(${ids.join(',')})`], limit: 500,
      }),
      restSelect<ConsumptionSourceRow>('fx_lot_consumptions', {
        match: { company, currency, source_type: 'daily_report_item' },
        filters: [`source_id=in.(${ids.join(',')})`], limit: 500,
      }),
      restSelect<IgnoredRow>('fx_ledger_reconcile_ignored', {
        match: { company, currency },
        filters: [`daily_id=in.(${ids.join(',')})`], limit: 500,
      }),
    ])
    const reflectedIn = new Map<string, number>()
    for (const r of lotRows ?? []) reflectedIn.set(r.source_id, (reflectedIn.get(r.source_id) ?? 0) + Number(r.original_amount))
    const reflectedOut = new Map<string, number>()
    for (const r of consRows ?? []) reflectedOut.set(r.source_id, (reflectedOut.get(r.source_id) ?? 0) + Number(r.amount))
    const ignored = new Set((ignoredRows ?? []).map(r => r.daily_id))

    const pending: PendingReconcileItem[] = []
    for (const d of deltas) {
      if (ignored.has(d.dailyId)) continue
      const already = d.delta > 0 ? (reflectedIn.get(d.dailyId) ?? 0) : (reflectedOut.get(d.dailyId) ?? 0)
      const remain = Math.abs(d.delta) - already
      if (remain > 0.5) pending.push({ dailyId: d.dailyId, date: d.date, direction: d.delta > 0 ? 'in' : 'out', amount: remain })
    }
    pending.sort((a, b) => b.date.localeCompare(a.date))
    setItems(pending)
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
