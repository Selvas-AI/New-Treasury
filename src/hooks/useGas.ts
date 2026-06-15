/**
 * GAS Web App API 헬퍼 (Code.gs v4 기준)
 * - 주가 조회:      ticker=108860
 * - 채권 시세:      type=bond&isinCd=KR1030023165
 * - 환율 조회:      type=fx
 * - FX 표준편차:    type=fxstddev  (한국은행 ECOS API — GAS에 ECOS_API_KEY 필요)
 *
 * ※ GAS Web App은 항상 HTTP 200 반환 — 에러는 응답 body의 success:false 로 판별
 */

const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined
const TIMEOUT_MS   = 30000   // GAS 콜드 스타트 대응: 30초
const RETRY_LIMIT  = 1       // 타임아웃 시 1회 자동 재시도

export interface StockPriceResult {
  code: string
  price: number
  date: string
  change?: number
  changePct?: number  // 등락률 (%)
}

export interface StockSearchResult extends StockPriceResult {
  ticker: string
  name:   string
  market: string
  candidates: { ticker: string; name: string; market: string }[]
}

export interface BondPriceResult {
  isin: string
  price: number
  date: string
}

export interface BondSearchResult extends BondPriceResult {
  name:       string
  candidates: { isin: string; name: string }[]
}

interface GasStockRaw {
  success: boolean
  price: number
  change: number | null
  changeRate: number | null
  date: string
  symbol: string
  error?: string
  // 이름 검색 추가 필드
  ticker?: string
  name?: string
  market?: string
  candidates?: { ticker: string; name: string; market: string }[]
}

interface GasBondRaw {
  success: boolean
  price: number
  date: string
  isinCd: string
  error?: string
  // 이름 검색 추가 필드
  name?: string
  candidates?: { isin: string; name: string }[]
}

interface GasFxRaw {
  success: boolean
  rates: Record<string, number>
  date: string
  error?: string
}

async function gasGetOnce<T>(params: Record<string, string>): Promise<T> {
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
      throw new Error(`GAS 응답 시간 초과 (${TIMEOUT_MS / 1000}s)`, { cause: e })
    }
    throw e
  }
}

/** 타임아웃 시 RETRY_LIMIT 회 자동 재시도 */
async function gasGet<T>(params: Record<string, string>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
    try {
      return await gasGetOnce<T>(params)
    } catch (e) {
      lastErr = e
      const isTimeout = e instanceof Error && e.message.includes('초과')
      if (!isTimeout || attempt >= RETRY_LIMIT) throw e
      // 콜드 스타트 후 warm-up 대기 (500ms)
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw lastErr
}

/** 주가 단건 조회 — GAS v3: ticker=108860 / basDt=YYYY-MM-DD (과거 종가) */
export async function fetchStockPrice(code: string, basDt?: string): Promise<StockPriceResult> {
  const params: Record<string, string> = { ticker: code }
  if (basDt) params.basDt = basDt.replace(/-/g, '')  // YYYYMMDD 형식으로 변환
  const raw = await gasGet<GasStockRaw>(params)
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

/** 종목명으로 주식 검색 + 시세 조회 — GAS: ?name=셀바스에이아이 (basDt: 과거 종가) */
export async function fetchStockByName(name: string, basDt?: string): Promise<StockSearchResult> {
  const params: Record<string, string> = { name }
  if (basDt) params.basDt = basDt.replace(/-/g, '')
  const raw = await gasGet<GasStockRaw>(params)
  if (!raw.success) throw new Error(raw.error ?? '종목 조회 실패')
  return {
    code:       raw.symbol ?? raw.ticker ?? '',
    ticker:     raw.ticker ?? raw.symbol ?? '',
    name:       raw.name   ?? name,
    market:     raw.market ?? '',
    price:      raw.price,
    date:       raw.date,
    change:     raw.change    ?? undefined,
    changePct:  raw.changeRate ?? undefined,
    candidates: raw.candidates ?? [],
  }
}

/** 채권명으로 채권 검색 + 기준가 조회 — GAS: ?type=bond&bondName=국고채 */
export async function fetchBondByName(bondName: string): Promise<BondSearchResult> {
  const raw = await gasGet<GasBondRaw>({ type: 'bond', bondName })
  if (!raw.success) throw new Error(raw.error ?? '채권 조회 실패')
  return {
    isin:       raw.isinCd  ?? '',
    name:       raw.name    ?? bondName,
    price:      raw.price,
    date:       raw.date,
    candidates: raw.candidates ?? [],
  }
}

/** 환율 조회 — GAS v3: type=fx → { success, rates: { USD, EUR, ... } } */
export async function fetchExchangeRates(): Promise<Record<string, number>> {
  const raw = await gasGet<GasFxRaw>({ type: 'fx' })
  if (!raw.success) throw new Error(raw.error ?? '환율 조회 실패')
  return raw.rates
}

// ── FX 표준편차 자동계산 ────────────────────────────────────────────

export interface FxStdDevResult {
  period: { from: string; to: string }
  dataCount: number
  stddev: {
    USD: number | null
    EUR: number | null
    JPY: number | null
    GBP: number | null
  }
  source: string
}

interface GasFxStdDevRaw {
  success: boolean
  period?: { from: string; to: string }
  dataCount?: number
  stddev?: Record<string, number | null>
  source?: string
  error?: string
  guide?: string
}

/**
 * GAS → ECOS API 경유로 과거 1년 일별 환율 표준편차 자동계산
 * GAS 스크립트 속성에 ECOS_API_KEY 필요
 */
export async function fetchFxStdDev(months = 12): Promise<FxStdDevResult> {
  const raw = await gasGet<GasFxStdDevRaw>({ type: 'fxstddev', months: String(months) })
  if (!raw.success) {
    const msg = raw.error ?? 'FX 표준편차 계산 실패'
    const guide = raw.guide ? ` (${raw.guide})` : ''
    throw new Error(msg + guide)
  }
  return {
    period:    raw.period!,
    dataCount: raw.dataCount ?? 0,
    stddev: {
      USD: raw.stddev?.USD ?? null,
      EUR: raw.stddev?.EUR ?? null,
      JPY: raw.stddev?.JPY ?? null,
      GBP: raw.stddev?.GBP ?? null,
    },
    source: raw.source ?? 'ecos.bok.or.kr',
  }
}
