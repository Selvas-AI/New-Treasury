import { useCallback, useEffect, useState } from 'react'
import { restSelect } from '../lib/supabase'
import type { Company } from '../types'

export interface RegimeSnapshotHistoryRow {
  id: string
  snapshot_date: string
  target_pct: number | null
  current_pct: number | null
  suggest_krw: number
  since_date: string | null
  captured_by: string | null
  captured_at: string
}

/**
 * FX 리짐 조치 카드 이력 조회 (세션26차 7일차).
 *
 * fx_regime_snap_*(policy_params)은 판정할 때마다 덮어써 "지금" 상태만 남는다.
 * 값이 바뀔 때마다 한 줄씩 쌓인 fx_regime_snapshot_history 를 읽어 과거 특정
 * 날짜의 조치 카드를 재구성한다. 이 테이블 도입 이후 시점부터만 조회 가능하다.
 */
export function useFxRegimeSnapshotHistory(company: Company, currency: string) {
  const [rows, setRows] = useState<RegimeSnapshotHistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await restSelect<RegimeSnapshotHistoryRow>('fx_regime_snapshot_history', {
      match: { company, currency }, order: 'snapshot_date.desc,captured_at.desc', limit: 300,
    })
    setRows(data ?? [])
    setLoading(false)
  }, [company, currency])

  useEffect(() => { void load() }, [load])

  /** 선택한 날짜 이하 가장 최근 스냅샷 — "그날 조치 카드가 어땠는지" */
  const asOfDate = useCallback((date: string) => rows.find(r => r.snapshot_date <= date) ?? null, [rows])

  return { rows, loading, reload: load, asOfDate }
}
