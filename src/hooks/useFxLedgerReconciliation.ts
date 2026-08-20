import { useCallback, useEffect, useState } from 'react'
import { restSelect, restInsert } from '../lib/supabase'
import { generateUUID } from '../lib/format'
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
interface LotSourceRow { source_id: string; original_amount: number }
interface ConsumptionSourceRow { source_id: string; amount: number }
interface LotDateRow { acquired_date: string; original_amount: number }
interface ConsumptionDateRow { disposed_date: string; amount: number }
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
 * 미반영액 = |오늘잔액 − 전일잔액| − (그날 원장에 **이미 기록된** 순증감)
 *
 * [이중 차감 버그 — 2026-08-20 수정] 과거엔 "이미 반영된 금액"을 셀 때
 *   source_type='daily_report_item' **만** 봤다. 그래서 매각 체결로 원장에서 이미 빠진
 *   금액(source_type='fx_trade_history')이 안 세어져 "미반영"으로 떴고, 사용자가 "반영"을
 *   누르면 **같은 금액이 원장에서 또 빠졌다.**
 *   실무는 거래를 실시간으로 원장에 넣고 자금현황은 익일 기재하므로, 원장에 이미 있는
 *   그날 거래는 전부 차감해야 한다. 정상 운영이면 미반영액이 0 이 되어 패널이 조용해진다.
 *
 * 매칭 키가 두 종류다:
 *   - daily_report_item : 이 패널이 만든 것이라 **source_id = daily.id** 로 정확히 매칭
 *   - 그 외(매각 체결/수동 유출/이자 등) : **거래일(txnDate)** 로 매칭.
 *     daily[X] 는 전영업일 마감이므로 **X 행의 델타는 전영업일 거래**다.
 *
 * 계좌 대체(source_type='transfer')는 **차감하지 않는다.** 같은 통화 안의 이동이라
 *   총 잔액이 변하지 않고 daily 델타에도 나타나지 않는다 - 차감하면 오히려 어긋난다.
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
    // txnDate = 이 델타가 나타내는 **실제 거래일**.
    // daily[X] 는 전영업일 마감이므로, X 행의 델타는 전영업일(rows[i-1].date)의 거래다.
    // 원장 거래는 거래일로 기록되므로 이 키로 매칭해야 한다.
    const deltas: { dailyId: string; date: string; txnDate: string; delta: number }[] = []
    for (let i = 1; i < rows.length; i++) {
      if (fromDate && rows[i].date < fromDate) continue
      const delta = Number(rows[i][field] ?? 0) - Number(rows[i - 1][field] ?? 0)
      if (Math.abs(delta) > 0.000001) {
        deltas.push({ dailyId: rows[i].id, date: rows[i].date, txnDate: rows[i - 1].date, delta })
      }
    }
    if (!deltas.length) { setItems([]); setLoading(false); return }

    const ids = deltas.map(d => d.dailyId)
    const minTxnDate = deltas.reduce((m, d) => (d.txnDate < m ? d.txnDate : m), deltas[0].txnDate)
    const [
      { data: lotRows }, { data: consRows },
      { data: lotDateRows }, { data: consDateRows },
      { data: ignoredRows },
    ] = await Promise.all([
      restSelect<LotSourceRow>('fx_lots', {
        match: { company, currency, source_type: 'daily_report_item' },
        filters: [`source_id=in.(${ids.join(',')})`], limit: 500,
      }),
      restSelect<ConsumptionSourceRow>('fx_lot_consumptions', {
        match: { company, currency, source_type: 'daily_report_item' },
        filters: [`source_id=in.(${ids.join(',')})`], limit: 500,
      }),
      // 그 외 원장 거래 - 거래일로 매칭. opening(개시 스냅샷)/transfer(총액 불변) 제외.
      restSelect<LotDateRow>('fx_lots', {
        match: { company, currency },
        filters: [`acquired_date=gte.${minTxnDate}`,
                  'source_type=not.in.(opening,daily_report_item,transfer)'], limit: 1000,
      }),
      restSelect<ConsumptionDateRow>('fx_lot_consumptions', {
        match: { company, currency },
        filters: [`disposed_date=gte.${minTxnDate}`,
                  'source_type=not.in.(daily_report_item,transfer)'], limit: 1000,
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
    // 거래일 기준 집계 - 원장이 이미 아는 그날의 유입/유출
    const ledgerInByDate = new Map<string, number>()
    for (const r of lotDateRows ?? []) {
      ledgerInByDate.set(r.acquired_date, (ledgerInByDate.get(r.acquired_date) ?? 0) + Number(r.original_amount))
    }
    const ledgerOutByDate = new Map<string, number>()
    for (const r of consDateRows ?? []) {
      ledgerOutByDate.set(r.disposed_date, (ledgerOutByDate.get(r.disposed_date) ?? 0) + Number(r.amount))
    }
    const ignored = new Set((ignoredRows ?? []).map(r => r.daily_id))

    const pending: PendingReconcileItem[] = []
    for (const d of deltas) {
      if (ignored.has(d.dailyId)) continue
      // 순증감으로 본다 - 같은 날 유입과 유출이 함께 있으면 상계돼야 델타와 맞는다.
      const ledgerNet = (ledgerInByDate.get(d.txnDate) ?? 0) - (ledgerOutByDate.get(d.txnDate) ?? 0)
      const remainDelta = d.delta - ledgerNet
      const bySource = remainDelta > 0 ? (reflectedIn.get(d.dailyId) ?? 0) : (reflectedOut.get(d.dailyId) ?? 0)
      const remain = Math.abs(remainDelta) - bySource
      if (remain > 0.5) {
        pending.push({ dailyId: d.dailyId, date: d.date, txnDate: d.txnDate,
          direction: remainDelta > 0 ? 'in' : 'out', amount: remain })
      }
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
