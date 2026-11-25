/**
 * useReportItemLedger — 자금일보 항목 중 외화거래명세(원장)에 반영된 것 (2026-11-25)
 *
 * 원장 쪽 기록: fx_lots / fx_lot_consumptions 의 source_type='report_item', source_id=항목 id.
 * 항목 행의 "원장 반영됨 / 환율 필요" 배지가 이 결과를 쓴다.
 *
 * ⚠ 원장을 다시 계산하지 않는다 — 반영 여부만 본다. 반영·해제는 서버 RPC
 *   sync_report_item_ledger 가 한다(규칙은 lib/fxReportItemLedger 와 SQL 이 같다).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { restRpc, restSelect } from '../lib/supabase'
import { isLedgerRpcMissing } from '../lib/fxReportItemLedger'

export function useReportItemLedger(itemIds: string[]) {
  const [reflected, setReflected] = useState<Set<string>>(new Set())
  const key = [...itemIds].sort().join(',')

  const refetch = useCallback(async () => {
    if (!key) { setReflected(new Set()); return }
    const filter = [`source_type=eq.report_item`, `source_id=in.(${key})`]
    const [lots, cons] = await Promise.all([
      restSelect<{ source_id: string }>('fx_lots', { filters: filter, limit: 1000 }),
      restSelect<{ source_id: string }>('fx_lot_consumptions', { filters: filter, limit: 1000 }),
    ])
    const ids = new Set<string>()
    for (const r of lots.data ?? []) ids.add(r.source_id)
    for (const r of cons.data ?? []) ids.add(r.source_id)
    setReflected(ids)
  }, [key])

  useEffect(() => { void refetch() }, [refetch])

  /**
   * 항목 1건을 원장과 맞춘다 — 기존 반영을 되돌리고 현재 값으로 다시 반영.
   * @param txnDate 거래일 = 자금일보 보고대상일(작성일의 전영업일)
   * @param remove  true = 반영만 되돌린다(항목 삭제 직전)
   * @returns 오류 문구(없으면 null)
   */
  const sync = useCallback(async (itemId: string, txnDate: string, by: string, remove = false) => {
    const { error } = await restRpc('sync_report_item_ledger', {
      p_item_id: itemId, p_txn_date: txnDate, p_by: by, p_remove: remove,
    })
    if (error) {
      return isLedgerRpcMissing(error.message)
        ? '외화거래명세 자동 반영은 아직 켜지지 않았습니다(docs/db/fx_report_item_ledger.sql 실행 필요). 자금일보 항목은 저장됐습니다.'
        : error.message
    }
    await refetch()
    return null
  }, [refetch])

  return useMemo(() => ({ reflected, refetch, sync }), [reflected, refetch, sync])
}
