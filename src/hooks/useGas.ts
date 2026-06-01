/**
 * GAS Web App API 헬퍼 (Code.gs v3 기준)
 * - 주가 조회: ticker=108860
 * - 채권 시세:  type=bond&isinCd=KR1030023165
 * - 환율 조회: type=fx
 *
 * ※ GAS Web App은 항상 HTTP 200 반환 — 에러는 응답 body의 success:false 로 판별
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined
const TIMEOUT_MS = 10000

export interface StockPriceResult {
  code: string
  price: number
  date: string
  change?: number
  changePct?: number  // 등락률 (%)
}

export interface BondPriceResult {
  isin: string
  price: number
  date: string
}

interface GasStockRaw {
  success: boolean
  price: number
  change: number | null
  changeRate: number | null
  date: string
  symbol: string
  error?: string
}

interface GasBondRaw {
  success: boolean
  price: number
  date: string
  isinCd: string
  error?: string
}

interface GasFxRaw {
  success: boolean
  rates: Record<string, number>
  date: string
  error?: string
}

async function gasGet<T>(params: Record<string, string>): Promise<T> {
  if (!GAS_URL) throw new Error('VITE_GAS_API_URL 미설정')

  const qs  = new URLSearchParams(params).toString()
  const url = `${GAS_URL}?${qs}`

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`GAS HTTP ${res.status}`)

    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      throw new Error('GAS가 HTML을 반환했습니다. 배포 설정(액세스: 모든 사용자)을 확인하세요.')
    }

    return JSON.parse(text) as T
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`GAS 응답 시간 초과 (${TIMEOUT_MS / 1000}s)`)
    }
    throw e
  }
}

/** 주가 단건 조회 — GAS v3: ticker=108860 */
export async function fetchStockPrice(code: string): Promise<StockPriceResult> {
  const raw = await gasGet<GasStockRaw>({ ticker: code })
  if (!raw.success) throw new Error(raw.error ?? '주가 조회 실패')
  return {
    code:      raw.symbol ?? code,
    price:     raw.price,
    date:      raw.date,
    change:    raw.change    ?? undefined,
    changePct: raw.changeRate ?? undefined,
  }
}

/** 채권 기준가 조회 — GAS v3: type=bond&isinCd=... */
export async function fetchBondPrice(isin: string, basDt?: string): Promise<BondPriceResult> {
  const params: Record<string, string> = { type: 'bond', isinCd: isin }
  if (basDt) params.basDt = basDt
  const raw = await gasGet<GasBondRaw>(params)
  if (!raw.success) throw new Error(raw.error ?? '채권 시세 조회 실패')
  return { isin: raw.isinCd ?? isin, price: raw.price, date: raw.date }
}

/** 환율 조회 — GAS v3: type=fx → { success, rates: { USD, EUR, ... } } */
export async function fetchExchangeRates(): Promise<Record<string, number>> {
  const raw = await gasGet<GasFxRaw>({ type: 'fx' })
  if (!raw.success) throw new Error(raw.error ?? '환율 조회 실패')
  return raw.rates
}
