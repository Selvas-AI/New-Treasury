// ─── 인증 ───────────────────────────────────────────────
// master > admin > editor > viewer (계층 순)
// 'ceo' | 'company' 는 레거시 — 기존 코드 호환 유지, 신규 사용 금지
export type UserRole = 'master' | 'admin' | 'editor' | 'viewer' | 'ceo' | 'company'

// 섹션별 작업 권한 (action_permissions 키)
export type SectionKey =
  'operating' | 'invest' | 'loans' | 'equity' |
  'daily_write' | 'daily_submit' | 'history' | 'issue_history'

export type ActionKey = 'view' | 'write' | 'delete'

export interface SectionPermission { view: boolean; write: boolean; delete: boolean }

// 자금일보 카테고리 권한 (allowed_categories)
export interface CategoryPermissions {
  in:  string[] | null   // null = 전체 허용
  out: string[] | null
}

export interface TreasuryUser {
  // ── Supabase Auth 연동 ──
  sb_id:   string           // auth.users.id (uuid)
  email:   string

  // ── treasury_users 프로필 ──
  code:    string           // user_code (감사추적용 단축 식별자)
  label:   string           // name (표시명)
  role:    UserRole

  // 법인 접근
  company:   Company | null  // 대표 법인 (companies[0] 또는 null)
  companies: string[]       // 접근 허용 법인 목록 (빈 배열=역할 기본값)

  // 권한 플래그
  menus:              string[] | null                              // null=역할 기본값
  can_delete:         boolean
  can_approve:        boolean
  // 세분화 권한 (null=역할 기본값 적용 → 기존 동작 그대로 유지)
  allowed_categories: CategoryPermissions | null
  action_permissions: Partial<Record<SectionKey, SectionPermission>> | null
}

export type Company = string  // DB-driven (companies 테이블); 기존 하드코딩 레거시 제거

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

// ─── 정책회의 (policy_meetings) ─────────────────────────
export interface PolicyMeeting {
  id: string
  title: string
  meeting_type: '정책회의' | '운영회의'
  held_at: string       // YYYY-MM-DD
  created_by: string
  created_at: string
}

// ─── 의결사항 (policy_decisions) ────────────────────────
export type DecisionStatus = 'pending' | 'in_progress' | 'completed'

export interface PolicyDecision {
  id: string
  meeting_id: string
  company: Company
  title: string
  decision: string
  owner: string
  due_date: string      // YYYY-MM-DD
  status: DecisionStatus
  created_at: string
}

// ─── 정책 파라미터 (policy_params) ──────────────────────
export interface PolicyParam {
  id: string
  company: Company
  param_key: string
  param_value: number | null
  param_text: string | null
  updated_by: string
  updated_at: string
}

// ─── 공통 훅 반환 타입 ────────────────────────────────────
export interface UseQueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}
