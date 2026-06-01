/**
 * GAS Web App API 헬퍼
 * - 주가 조회: action=getStockPrice&code=005930
 * - 채권 시세 조회: action=getBondPrice&isin=KR1030023165&basDt=20260529 (선택)
 * - 환율 조회: action=getExchangeRates
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined

export interface StockPriceResult {
  code: string
  price: number
  date: string   // YYYY-MM-DD
}

export interface BondPriceResult {
  isin: string
  price: number  // 기준가 (÷10 = 1좌당)
  date: string   // YYYY-MM-DD
}

async function gasGet<T>(params: Record<string, string>): Promise<T> {
  if (!GAS_URL) throw new Error('VITE_GAS_API_URL 미설정')
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${GAS_URL}?${qs}`)
  if (!res.ok) throw new Error(`GAS HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** 주가 단건 조회 */
export async function fetchStockPrice(code: string): Promise<StockPriceResult> {
  return gasGet<StockPriceResult>({ action: 'getStockPrice', code })
}

/** 채권 기준가 조회 (basDt 생략 시 최근 유효 데이터) */
export async function fetchBondPrice(isin: string, basDt?: string): Promise<BondPriceResult> {
  const params: Record<string, string> = { action: 'getBondPrice', isin }
  if (basDt) params.basDt = basDt
  return gasGet<BondPriceResult>(params)
}
