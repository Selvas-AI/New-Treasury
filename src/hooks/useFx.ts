import { useState, useCallback, useMemo } from 'react'
import { fetchExchangeRates } from './useGas'
import type { FxRate, FxCode } from '../types'

// GAS(open.er-api.com)는 모든 통화를 1단위 KRW으로 반환 (JPY도 1엔당)
// Sidebar 등 "100엔 기준" 표시는 각 컴포넌트에서 rate × 100 처리
const FX_UNITS: Record<FxCode, number> = {
  USD: 1, EUR: 1, JPY: 1, GBP: 1, CNY: 1,
}

export function useFx(): {
  rates: FxRate[]
  loading: boolean
  error: string | null
  fetchRates: () => Promise<void>
  /** amount(외화) → 원화 환산 */
  toKRW: (amount: number, code: FxCode) => number
} {
  const [rates, setRates] = useState<FxRate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchExchangeRates()
      const parsed: FxRate[] = (Object.keys(FX_UNITS) as FxCode[]).map(code => ({
        code,
        rate: json[code] ?? 0,
        unit: FX_UNITS[code],
      }))
      setRates(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : '환율 조회 실패')
    }
    setLoading(false)
  }, [])

  // ⚠️ [CRITICAL] toKRW·반환객체를 메모이즈하지 않으면 매 렌더마다 새 참조가 생성되어
  // 이를 의존하는 useMemo(investGroups 등)·useEffect(자동기재)가 무한 재실행 →
  // "Maximum update depth exceeded" 발생 (자금일보 페이지 무한 로딩 원인).
  const toKRW = useCallback((amount: number, code: FxCode): number => {
    const fx = rates.find(r => r.code === code)
    if (!fx || !fx.rate) return 0
    return amount * (fx.rate / fx.unit)
  }, [rates])

  return useMemo(
    () => ({ rates, loading, error, fetchRates, toKRW }),
    [rates, loading, error, fetchRates, toKRW],
  )
}
