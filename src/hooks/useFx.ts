import { useState, useCallback, useMemo, useEffect } from 'react'
import { fetchExchangeRates } from './useGas'
import type { FxRate, FxCode } from '../types'

// GAS(open.er-api.com)는 모든 통화를 1단위 KRW으로 반환 (JPY도 1엔당)
// Sidebar 등 "100엔 기준" 표시는 각 컴포넌트에서 rate × 100 처리
const FX_UNITS: Record<FxCode, number> = {
  USD: 1, EUR: 1, JPY: 1, GBP: 1, CNY: 1,
}

// ── [CRITICAL] 공유 FX 캐시 + in-flight 중복 제거 ──────────────────
// useFx()가 11곳 이상에서 각각 독립 호출 → GAS UrlFetch 일일 할당량 폭발(2026-07-01 실장애).
// 모듈 레벨 캐시(TTL)와 단일 in-flight 프로미스로 다중 인스턴스의 호출을 1건으로 합친다.
const TTL_MS = 4 * 60 * 1000  // 4분: 이 안에는 캐시 재사용(네트워크 호출 없음)
let sharedRates: FxRate[] = []
let sharedAt = 0
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify() { listeners.forEach(l => l()) }
function isFresh() { return sharedRates.length > 0 && Date.now() - sharedAt < TTL_MS }

/** 실제 GAS 호출은 여기 한 곳에서만. 동시 요청은 같은 프로미스를 공유. */
function loadShared(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    const json = await fetchExchangeRates()
    sharedRates = (Object.keys(FX_UNITS) as FxCode[]).map(code => ({
      code,
      rate: json[code] ?? 0,
      unit: FX_UNITS[code],
    }))
    sharedAt = Date.now()
    notify()
  })().finally(() => { inflight = null })
  return inflight
}

export function useFx(): {
  rates: FxRate[]
  loading: boolean
  error: string | null
  fetchRates: () => Promise<void>
  /** amount(외화) → 원화 환산 */
  toKRW: (amount: number, code: FxCode) => number
} {
  const [rates, setRates] = useState<FxRate[]>(sharedRates)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 다른 인스턴스가 캐시를 갱신하면 이 인스턴스도 동기화
  useEffect(() => {
    const l = () => setRates(sharedRates)
    listeners.add(l)
    if (rates !== sharedRates) setRates(sharedRates)  // 마운트 시 현재 캐시 반영
    return () => { listeners.delete(l) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRates = useCallback(async () => {
    // 캐시가 신선하면 네트워크 호출 없이 로컬 상태만 동기화
    if (isFresh()) { setRates(sharedRates); return }
    setLoading(true)
    setError(null)
    try {
      await loadShared()      // 동시 다발 호출도 단일 GAS 요청으로 합쳐짐
      setRates(sharedRates)
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
