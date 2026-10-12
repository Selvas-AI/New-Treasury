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
//
// ⚠⚠ [CRITICAL] 환율이 없으면 toKRW 가 0 을 돌려준다 = **외화가 합계에서 통째로 사라진다**.
//   2026-10-12 실사용 리포트: "환율 연결이 끊기면 자금일보·전체 잔액에서 외화 금액이
//   제외되어 표시된다". 조회 실패가 곧 "28억원이 없는 것처럼 보이는" 사고가 된다.
//   그래서 아래 세 가지를 둔다.
//     ① localStorage 영속 — 마지막 성공 환율을 보관해 새로고침·실패 후에도 환산을 유지
//     ② 직접 호출 우선   — GAS(할당량·콜드스타트)를 거치지 않는 경로를 1순위로
//     ③ stale 플래그     — 옛 환율로 계산 중이라는 사실을 화면이 숨기지 않게
//   금지: 조회 실패를 조용히 0 으로 때우지 말 것.
const TTL_MS = 4 * 60 * 1000  // 4분: 이 안에는 캐시 재사용(네트워크 호출 없음)
const LS_KEY = 'treasury_fx_rates'

let sharedRates: FxRate[] = []
let sharedAt = 0                       // 마지막 **성공** 시각 (epoch ms)
let sharedSource: FxSource | null = null
let lastError: string | null = null    // 마지막 시도 실패 사유 — 있으면 지금 값은 최신이 아니다
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

export type FxSource = 'direct' | 'gas' | 'cache'

interface FxCachePayload { at: number; rates: FxRate[] }

function notify() { listeners.forEach(l => l()) }
function isFresh() { return sharedRates.length > 0 && Date.now() - sharedAt < TTL_MS }

function persist() {
  try {
    const payload: FxCachePayload = { at: sharedAt, rates: sharedRates }
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch { /* quota·사생활 모드 — 메모리 캐시만으로 계속 동작 */ }
}

/** 마지막 성공 환율 복원 — 앱 시작 시 1회. 실패 상태로 시작해도 환산은 가능하게 한다. */
function restore() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as FxCachePayload
    if (!Array.isArray(p?.rates) || !p.rates.length || !p.at) return
    sharedRates = p.rates.filter(r => r && typeof r.rate === 'number' && r.rate > 0)
    sharedAt = p.at
    sharedSource = 'cache'
  } catch { /* 손상된 값 무시 */ }
}
restore()

function toFxRates(json: Record<string, number>): FxRate[] {
  return (Object.keys(FX_UNITS) as FxCode[]).map(code => ({
    code, rate: json[code] ?? 0, unit: FX_UNITS[code],
  }))
}

/**
 * 1순위: 환율 API 직접 호출.
 *
 * GAS 가 하던 일과 **같은 소스**(open.er-api.com)다. GAS 는 프록시였을 뿐인데,
 * 그 때문에 일일 할당량·콜드스타트를 그대로 떠안고 있었다. 이 API 는
 * `access-control-allow-origin: *` 라 브라우저에서 바로 부를 수 있다(2026-10-12 확인).
 * ⚠ 기준 통화는 USD 다 — KRW 환산은 r.KRW / r.{통화} 로 역산한다(GAS 와 동일 공식).
 */
async function fetchDirect(): Promise<Record<string, number>> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal })
    if (!res.ok) throw new Error(`환율 API HTTP ${res.status}`)
    const j = await res.json() as { result?: string; rates?: Record<string, number> }
    const r = j.rates
    if (j.result !== 'success' || !r?.KRW) throw new Error('환율 데이터 없음')
    const krw = r.KRW
    const out: Record<string, number> = { USD: Math.round(krw * 100) / 100 }
    for (const c of ['EUR', 'JPY', 'GBP', 'CNY'] as const) {
      if (r[c] > 0) out[c] = Math.round((krw / r[c]) * 100) / 100
    }
    return out
  } finally { window.clearTimeout(timer) }
}

/**
 * 실제 조회는 여기 한 곳에서만. 동시 요청은 같은 프로미스를 공유.
 * 직접 호출 → 실패 시 GAS 폴백. 둘 다 실패하면 **기존 캐시를 유지**하고 stale 로 표시한다.
 */
function loadShared(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    let json: Record<string, number>
    let source: FxSource
    try {
      json = await fetchDirect()
      source = 'direct'
    } catch (e1) {
      try {
        json = await fetchExchangeRates()   // GAS 폴백 (서킷브레이커·타임아웃 내장)
        source = 'gas'
      } catch (e2) {
        // ⚠ 캐시를 지우지 않는다 — 지우면 외화가 합계에서 사라진다.
        lastError = [e1, e2].map(e => (e instanceof Error ? e.message : String(e))).join(' / ')
        notify()
        throw new Error(lastError, { cause: e2 })
      }
    }
    const next = toFxRates(json)
    if (!next.some(r => r.rate > 0)) {
      lastError = '환율 응답에 유효한 값이 없습니다'
      notify()
      throw new Error(lastError)
    }
    sharedRates = next
    sharedAt = Date.now()
    sharedSource = source
    lastError = null
    persist()
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
  /** 마지막 **성공** 조회 시각 (epoch ms). null=한 번도 받지 못함 */
  ratesAt: number | null
  /** 지금 쓰는 환율이 최신이 아님(마지막 조회 실패 → 캐시 사용 중) */
  stale: boolean
  /** 환율이 아예 없어 외화가 0원으로 환산되는 상태 — 합계를 믿으면 안 된다 */
  unavailable: boolean
  source: FxSource | null
} {
  const [rates, setRates] = useState<FxRate[]>(sharedRates)
  const [tick, setTick]   = useState(0)   // 모듈 상태(stale·ratesAt) 변화 반영용
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 다른 인스턴스가 캐시를 갱신하면 이 인스턴스도 동기화
  useEffect(() => {
    const l = () => { setRates(sharedRates); setTick(t => t + 1) }
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
      await loadShared()      // 동시 다발 호출도 단일 요청으로 합쳐짐
      setRates(sharedRates)
    } catch (e) {
      setError(e instanceof Error ? e.message : '환율 조회 실패')
    }
    setLoading(false)
  }, [])

  // ⚠️ [CRITICAL] toKRW·반환객체를 메모이즈하지 않으면 매 렌더마다 새 참조가 생성되어
  // 이를 의존하는 useMemo(investGroups 등)·useEffect(자동기재)가 무한 재실행 →
  // "Maximum update depth exceeded" 발생 (자금일보 페이지 무한 로딩 원인).
  //
  // ⚠ 환율이 없으면 0 을 돌려준다. 이건 "외화가 없다"가 아니라 "환산할 수 없다"는 뜻이다.
  //   호출부가 합계를 그대로 보여주면 외화가 사라진 것처럼 보이므로,
  //   아래 unavailable/stale 을 화면에 반드시 표시할 것(FxRateNotice).
  const toKRW = useCallback((amount: number, code: FxCode): number => {
    const fx = rates.find(r => r.code === code)
    if (!fx || !fx.rate) return 0
    return amount * (fx.rate / fx.unit)
  }, [rates])

  return useMemo(
    () => ({
      rates, loading, error, fetchRates, toKRW,
      ratesAt: sharedAt || null,
      stale: lastError != null && rates.some(r => r.rate > 0),
      unavailable: !rates.some(r => r.rate > 0),
      source: sharedSource,
    }),
    // tick — 모듈 레벨 상태(lastError·sharedAt)는 React 가 추적하지 못한다.
    // notify() 로 올라온 변화를 반영하려면 이 값이 deps 에 있어야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, loading, error, fetchRates, toKRW, tick],
  )
}
