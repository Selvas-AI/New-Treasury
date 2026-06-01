/**
 * GAS Web App API 헬퍼
 * - 주가 조회: action=getStockPrice&code=005930
 * - 채권 시세:  action=getBondPrice&isin=KR1030023165
 * - 환율 조회: action=getExchangeRates
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined
const TIMEOUT_MS = 8000

export interface StockPriceResult {
  code: string
  price: number
  date: string      // YYYY-MM-DD
  change?: number   // 전일 대비 등락 (원)
  changePct?: number // 등락률 (%)
}

export interface BondPriceResult {
  isin: string
  price: number   // 기준가 (÷10 = 1좌당)
  date: string
}

async function gasGet<T>(params: Record<string, string>): Promise<T> {
  if (!GAS_URL) throw new Error('VITE_GAS_API_URL 미설정')

  const qs  = new URLSearchParams(params).toString()
  const url = `${GAS_URL}?${qs}`

  // [버그 1 수정] abort timeout
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`GAS HTTP ${res.status}`)

    // [버그 2 수정] HTML 에러 응답 감지
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

/** 주가 단건 조회 */
export async function fetchStockPrice(code: string): Promise<StockPriceResult> {
  return gasGet<StockPriceResult>({ action: 'getStockPrice', code })
}

/** 채권 기준가 조회 */
export async function fetchBondPrice(isin: string, basDt?: string): Promise<BondPriceResult> {
  const params: Record<string, string> = { action: 'getBondPrice', isin }
  if (basDt) params.basDt = basDt
  return gasGet<BondPriceResult>(params)
}
