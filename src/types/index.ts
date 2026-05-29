// ─── 인증 ───────────────────────────────────────────────
export type UserRole = 'master' | 'ceo' | 'company'

export interface TreasuryUser {
  role: UserRole
  company: string | null
  label: string
  code: string
  sb_id: string
}

export type Company = '셀바스에이아이' | '셀바스헬스케어' | '메디아나'

// ─── 운전자금 (daily) ────────────────────────────────────
export interface DailyRecord {
  id: string
  company: Company
  date: string          // YYYY-MM-DD
  writer: string
  krw_demand: number    // 보통예금/CMA
  krw_govt: number      // 국책자금
  krw_mmda: number      // 증권 예수금
  fx_usd: number
  fx_eur: number
  fx_jpy: number
  fx_gbp: number
  fx_cny: number
  fx_krw: number        // 외화 원화환산 합계
  memo: string
}

// ─── 운용자금 / 국채 (investments) ──────────────────────
export interface InvestmentRecord {
  id: string
  company: Company
  bank: string
  product: string       // 정기예금 | RP | MMF | 국채 등
  currency: string
  amount: number
  available: '가용' | '불가용'
  rate: number
  start: string         // YYYY-MM-DD
  maturity: string      // YYYY-MM-DD
  active: boolean
  // 국채 전용
  bondName?: string
  bondTicker?: string   // ISIN
  bondQty?: number
  bondPrice?: number    // 기준가 (÷10 = 1좌당)
  priceDate?: string
  // 취득가액
  acquisition_cost: number
}

// ─── 차입금 (loans) ──────────────────────────────────────
export interface LoanRecord {
  id: string
  company: Company
  lender: string
  type: string
  currency: string
  amount: number
  rate: number
  start_date: string    // YYYY-MM-DD
  maturity: string      // YYYY-MM-DD
  active: boolean
}

// ─── 지분투자 (equities) ─────────────────────────────────
export interface EquityRecord {
  id: string
  company: Company
  name: string
  ticker: string
  market: 'KOSDAQ' | 'KOSPI' | '비상장'
  purpose: string
  available: '가용' | '불가용'
  shares: number
  price: number
  total_value: number
  date: string          // YYYY-MM-DD (날짜별 레코드)
  acquisition_cost: number
}

// ─── 이슈 코멘트 (issue_comments) ────────────────────────
export type IssueStatus = 'open' | 'review' | 'done'

export interface IssueComment {
  id: string
  issue_key: string     // loan_{uuid} | equity_{종목명} | input_daily
  company: Company
  user_label: string
  user_role: UserRole
  body: string
  status: IssueStatus
  issue_title: string
  issue_desc: string
  created_at: string    // ISO timestamptz
}

// ─── 환율 ────────────────────────────────────────────────
export type FxCode = 'USD' | 'EUR' | 'JPY' | 'GBP' | 'CNY'

export interface FxRate {
  code: FxCode
  rate: number          // 1외화 = N원
  unit: number          // JPY는 100단위
}

// ─── 공통 훅 반환 타입 ────────────────────────────────────
export interface UseQueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}
