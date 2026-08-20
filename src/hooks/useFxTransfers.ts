import { useCallback, useEffect, useState } from 'react'
import { restSelect } from '../lib/supabase'
import type { FxAccountType } from '../lib/fxLots'

export interface FxLotTransfer {
  id: string
  company: string
  currency: string
  transfer_date: string
  from_account_type: FxAccountType
  to_account_type: FxAccountType
  amount: number
  valuation_method: 'carryover' | 'revalue'
  transfer_rate: number | null
  realized_pnl: number
  maturity_date: string | null
  annual_interest_rate: number
  early_withdrawal: boolean
  investment_id: string | null
  memo: string | null
  created_by: string | null
  created_at: string
}

/**
 * 계좌 간 대체 이력 (세션26차 12일차).
 *
 * ⭐ 왜 별도 목록이 필요한가: 원가승계 대체로 만들어진 로트는 **원본의 취득일을 승계**하므로
 *   원장 표(유입일 정렬)에서 오늘 한 대체가 목록 중간에 끼어 들어간다. 그러면 방금 한 작업이
 *   "안 보이는" 것처럼 느껴진다(2026-08-20 실사용 리포트 — 보통예금→MMDA 대체 후 MMDA 탭에서
 *   찾지 못함). 대체는 **이벤트 단위로도** 볼 수 있어야 하고, 원복 경로도 여기 있어야 한다.
 */
export function useFxTransfers(company: string, currency: string) {
  const [transfers, setTransfers] = useState<FxLotTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await restSelect<FxLotTransfer>('fx_lot_transfers', {
      match: { company, currency }, order: 'transfer_date.desc', limit: 200,
    })
    if (err) { setError(err.message); setTransfers([]) }
    else setTransfers(data ?? [])
    setLoading(false)
  }, [company, currency])

  useEffect(() => { void refetch() }, [refetch])

  return { transfers, loading, error, refetch }
}
