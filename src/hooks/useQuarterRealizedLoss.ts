/**
 * useQuarterRealizedLoss — 이번 분기 기실현 손실 = 원장 집계 + 원장 외 보정 (2026-11-25 F-08)
 *
 * 계산 규칙은 lib/fxQuarterLoss. 이 훅은 조회만 한다.
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
  const [loading, setLoading] = useState(!!company)

  const refetch = useCallback(async () => {
    if (!company) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data } = await restSelect<QuarterConsumptionRow>('fx_lot_consumptions', {
      match: { company }, filters: [`disposed_date=gte.${q.start}`, `disposed_date=lte.${q.end}`], limit: 5000,
    })
    setRows(data ?? [])
    setLoading(false)
  }, [company, q.start, q.end])

  useEffect(() => { void refetch() }, [refetch])

  const ledgerKRW = useMemo(() => quarterRealizedLossKRW(rows, today).lossKRW, [rows, today])
  const adjustRaw = params.get(FX_OPS_PARAM_KEYS.lossAdjust(q.key))
  const adjustKRW = adjustRaw != null && adjustRaw > 0 ? adjustRaw : 0

  return useMemo(() => ({
    quarterKey: q.key, ledgerKRW, adjustKRW, totalKRW: ledgerKRW + adjustKRW, loading, refetch,
  }), [q.key, ledgerKRW, adjustKRW, loading, refetch])
}
