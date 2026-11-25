/**
 * useQuarterRealizedLoss — 이번 분기 기실현 손실 = 원장 집계 + 원장 외 보정 (2026-11-25 F-08)
 *
 * 계산 규칙은 lib/fxQuarterLoss. 이 훅은 조회만 한다.
 *
 * ⭐ 결정 D3(2026-11-25): 한도에는 **매각 실현손익만** 넣는다.
 *   재평가(revalue) 대체로 확정된 손익은 한도에 넣지 않되 **참고로 따로 보여 준다**(revalueNetKRW).
 *   그 손익은 대체 시점에 fx_lot_transfers.realized_pnl 에 기록된다.
 * ⚠ company 를 null 로 주면 아무것도 조회하지 않는다(이미 조회한 값을 주입받는 쪽에서 중복 방지).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { restSelect } from '../lib/supabase'
import { quarterOf, quarterRealizedLossKRW, type QuarterConsumptionRow } from '../lib/fxQuarterLoss'
import { FX_OPS_PARAM_KEYS } from '../lib/fxRegimeInputs'
import { todayStr } from '../lib/bizDay'

export interface QuarterLoss {
  quarterKey: string
  /** 원장 집계 손실(원, 양수) */
  ledgerKRW: number
  /** 원장 외 보정(원, 양수) — 원장에 없는 손실만 */
  adjustKRW: number
  /** 한도 계산에 쓰는 합계 */
  totalKRW: number
  /** 참고 — 이번 분기 재평가 대체 손익(순, 원). 한도 미포함(D3) */
  revalueNetKRW: number
  revalueCount: number
  loading: boolean
  refetch: () => Promise<void>
}

export function useQuarterRealizedLoss(
  company: string | null,
  params: { get: (key: string) => number | null },
): QuarterLoss {
  const today = todayStr()
  const q = quarterOf(today)
  const [rows, setRows] = useState<QuarterConsumptionRow[]>([])
  const [revalueRows, setRevalueRows] = useState<{ realized_pnl: number | null }[]>([])
  const [loading, setLoading] = useState(!!company)

  const refetch = useCallback(async () => {
    if (!company) { setRows([]); setRevalueRows([]); setLoading(false); return }
    setLoading(true)
    const [cons, reval] = await Promise.all([
      restSelect<QuarterConsumptionRow>('fx_lot_consumptions', {
        match: { company }, filters: [`disposed_date=gte.${q.start}`, `disposed_date=lte.${q.end}`], limit: 5000,
      }),
      restSelect<{ realized_pnl: number | null }>('fx_lot_transfers', {
        match: { company, valuation_method: 'revalue' },
        filters: [`transfer_date=gte.${q.start}`, `transfer_date=lte.${q.end}`], limit: 5000,
      }),
    ])
    setRows(cons.data ?? [])
    setRevalueRows(reval.data ?? [])
    setLoading(false)
  }, [company, q.start, q.end])

  useEffect(() => { void refetch() }, [refetch])

  const ledgerKRW = useMemo(() => quarterRealizedLossKRW(rows, today).lossKRW, [rows, today])
  const adjustRaw = params.get(FX_OPS_PARAM_KEYS.lossAdjust(q.key))
  const adjustKRW = adjustRaw != null && adjustRaw > 0 ? adjustRaw : 0

  const revalueNetKRW = useMemo(() => revalueRows.reduce((t, r) => t + Number(r.realized_pnl ?? 0), 0), [revalueRows])

  return useMemo(() => ({
    quarterKey: q.key, ledgerKRW, adjustKRW, totalKRW: ledgerKRW + adjustKRW,
    revalueNetKRW, revalueCount: revalueRows.length, loading, refetch,
  }), [q.key, ledgerKRW, adjustKRW, revalueNetKRW, revalueRows.length, loading, refetch])
}
