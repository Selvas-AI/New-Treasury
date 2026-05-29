import { useState, useCallback } from 'react'
import type { FxRate, FxCode } from '../types'

const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined

/** JPY는 100단위 고시 */
const FX_UNITS: Record<FxCode, number> = {
  USD: 1, EUR: 1, JPY: 100, GBP: 1, CNY: 1,
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
    if (!GAS_URL) {
      setError('VITE_GAS_API_URL이 설정되지 않았습니다.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${GAS_URL}?action=getExchangeRates`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as Record<string, number>
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

  function toKRW(amount: number, code: FxCode): number {
    const fx = rates.find(r => r.code === code)
    if (!fx || !fx.rate) return 0
    return amount * (fx.rate / fx.unit)
  }

  return { rates, loading, error, fetchRates, toKRW }
}
