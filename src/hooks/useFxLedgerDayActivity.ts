import { useCallback, useEffect, useState } from 'react'
import { restSelect } from '../lib/supabase'
import type { Company } from '../types'

export interface LedgerDayFlow {
  currency: string
  direction: 'in' | 'out'
  amount: number
  rate: number
  sourceType: string
  txnType: string | null
  memo: string | null
}

interface LotRow { currency: string; original_amount: number; acq_rate: number; source_type: string; txn_type: string | null; memo: string | null }
interface ConsRow { currency: string; amount: number; disposal_rate: number; source_type: string | null; txn_type: string | null; memo: string | null }

/**
 * 특정 **거래일**에 외화 원장에 기록된 증감 (세션26차 13일차).
 *
 * ⭐ 왜 필요한가: 실무는 거래를 **실시간으로 원장에 넣고**(매각 체결·수동 유출 등),
 *   자금현황은 **익일 아침에 기재**한다. 그래서 자금일보를 쓰는 사람은 "어제 외화가
 *   왜 이만큼 움직였는지"를 다른 화면에 가서 찾아야 했다.
 *   원천적으로 못 맞추는 차이를 경고로 띄우는 대신, **작성 시점에 근거를 보여준다.**
 *
 * ⚠ 계좌 대체(source_type='transfer')는 제외한다 — 같은 통화 안의 이동이라 잔액이
 *   변하지 않아 자금일보 잔액 증감과 무관하다.
 * ⚠ 개시 로트(source_type='opening')도 제외 — 거래가 아니라 최초 재고 스냅샷이다.
 */
export function useFxLedgerDayActivity(company: Company | null, txnDate: string | null) {
  const [flows, setFlows] = useState<LedgerDayFlow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!company || !txnDate) { setFlows([]); return }
    setLoading(true)
    const [{ data: lots }, { data: cons }] = await Promise.all([
      restSelect<LotRow>('fx_lots', {
        match: { company, acquired_date: txnDate },
        filters: ['source_type=not.in.(opening,transfer)'], limit: 200,
      }),
      restSelect<ConsRow>('fx_lot_consumptions', {
        match: { company, disposed_date: txnDate },
        filters: ['source_type=not.in.(transfer)'], limit: 200,
      }),
    ])
    const out: LedgerDayFlow[] = [
      ...(lots ?? []).map(r => ({
        currency: r.currency, direction: 'in' as const,
        amount: Number(r.original_amount), rate: Number(r.acq_rate),
        sourceType: r.source_type, txnType: r.txn_type, memo: r.memo,
      })),
      ...(cons ?? []).map(r => ({
        currency: r.currency, direction: 'out' as const,
        amount: Number(r.amount), rate: Number(r.disposal_rate),
        sourceType: r.source_type ?? '', txnType: r.txn_type, memo: r.memo,
      })),
    ]
    setFlows(out)
    setLoading(false)
  }, [company, txnDate])

  useEffect(() => { void load() }, [load])

  return { flows, loading, reload: load }
}
