// ─── 인증 ───────────────────────────────────────────────
// master > admin > editor > viewer (계층 순)
// 'ceo' | 'company' 는 레거시 — 기존 코드 호환 유지, 신규 사용 금지
export type UserRole = 'master' | 'admin' | 'editor' | 'viewer' | 'ceo' | 'company'

// 섹션별 작업 권한 (action_permissions 키)
export type SectionKey =
  'operating' | 'invest' | 'loans' | 'equity' |
  'daily_write' | 'daily_submit' | 'history' | 'issue_history' | 'fx_trade' | 'policy'

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

  // 비밀번호 정책 — master가 초기화한 임시 비밀번호로 로그인 시 true (다음 로그인 강제 변경)
  must_change_password: boolean
}

export type Company = string  // DB-driven (companies 테이블); 기존 하드코딩 레거시 제거

import type { FxOrderType } from '../lib/fxOrderType'
export type { FxOrderType }

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
  // 만기처리(active=false) 시점의 날짜 — 자금 이력(CashflowChart) 재구성 시
  // "이 날짜 이전에는 활성 상태였음"을 판별하기 위한 값. null=계속 활성
  closed_date?: string | null
}

// ─── 외화 환전 이력 (fx_trade_history) ──────────────────
export interface FxTradeRecord {
  id: string
  company: Company
  trade_date: string        // YYYY-MM-DD
  currency: string          // USD | EUR | JPY | GBP | CNY
  direction: string         // sell | buy (기본 sell)
  amount_fx: number         // 외화 금액
  acq_rate: number | null   // 장부환율 (가중평균 취득환율)
  trade_rate: number | null // 매각환율 (예정)
  amount_krw: number | null // 원화환산액
  fx_pnl: number | null     // 환차손익 (예상)
  status: string            // 발의 | 승인 | 부분체결 | 완료 | 취소
  memo: string | null
  created_by: string | null
  created_at: string
  // 승인 정보
  approved_by: string | null
  approved_at: string | null
  // 완료(체결) 정보 — 부분 체결 지원 후에는 "누적/가중평균" 값이다. 개별 체결
  // 내역은 fx_trade_fills(FxTradeFill)를 별도 조회해야 한다.
  completed_rate: number | null   // 누적 체결의 가중평균 환율
  completed_pnl: number | null    // 누적 확정 환차손익
  completed_at: string | null
  completed_by: string | null
  // 매각 지시 이행 기한 (세션20차 정책 이행 통제 — 등록일+3영업일, 환율 무관 실행 강제)
  due_date: string | null
  // threshold=보유비중 초과 / discretionary=정책회의 재량 / regime=리짐 권고(세션26차)
  order_type: FxOrderType | null
  // 지시 전체 수량 대비 누적 체결 수량 (세션26차 부분 체결)
  filled_amount: number
}

/**
 * fx_trade_fills — 매각 지시(FxTradeRecord) 1건에 딸린 개별 체결 내역.
 * 지시가 여러 영업일에 걸쳐 나눠 체결될 때, 체결마다 남는 행이다.
 */
export interface FxTradeFill {
  id: string
  trade_id: string
  company: Company
  currency: string
  fill_date: string
  amount_fx: number
  completed_rate: number
  realized_pnl: number
  completed_by: string | null
  created_at: string
}

/**
 * fx_lot_consumptions — 체결(FxTradeFill) 1건이 어느 FIFO 로트에서 얼마씩,
 * 그 로트의 장부환율(acq_rate)로 소진했는지의 상세. fill_id 로 체결과 연결된다.
 */
export interface FxLotConsumption {
  id: string
  lot_id: string
  fill_id: string | null
  disposed_date: string
  amount: number
  acq_rate: number       // 소진된 로트의 장부(취득)환율
  disposal_rate: number  // 처분(체결)환율
  realized_pnl: number
  /**
   * 이 소진을 일으킨 원천. 'fx_trade_history'(매각 체결) / 'daily_report_item'(자금일보
   * 반영) / 'manual'(수동 유출 등록). ⚠ 매각 체결이 아닌 소진은 fill_id 가 null 이라,
   * fill 기준으로만 화면을 만들면 **원장에서 통째로 사라진다**(세션26차 11일차 실사례).
   */
  source_type?: string | null
  source_id?: string | null
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
  // 상환처리(active=false) 시점의 날짜 — 자금 이력(CashflowChart) 재구성 시
  // "이 날짜 이전에는 활성 상태였음"을 판별하기 위한 값. null=계속 활성
  closed_date?: string | null
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

// 의결사항이 통제하는 실시간 지표 — 대시보드 자동 위반 감지 대상 (세션20차 정책 이행 통제 Phase 1)
// fx_regime_gap = 리짐 목표 잔존비중 대비 초과 보유 폭(%p) — 세션26차 Phase 4
//   ⚠ 실무 화면이 남긴 판정 스냅샷(fxRegimeSnapshot)을 읽는다. 스냅샷이 없으면 위반 없음.
export type PolicyLinkedMetric = 'fx_ratio' | 'loan_ratio' | 'liquidity' | 'fx_regime_gap'
export type PolicyTargetOperator = 'lte' | 'gte'   // lte=이 값 이하 유지, gte=이 값 이상 유지

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
  // 정량 규칙 (선택) — 셋 다 있어야 자동 위반 감지 대상이 됨. null=일반 의결(기한 감지만)
  linked_metric?: PolicyLinkedMetric | null
  target_operator?: PolicyTargetOperator | null
  target_value?: number | null
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
  // 정책회의 정정 감사 추적 (세션26차) — docs/db/policy_params_override_audit.sql
  // ⚠ 마이그레이션 미적용 환경에서는 응답에 아예 없으므로 optional 이다.
  overridden_by?: string | null
  overridden_at?: string | null
  override_note?: string | null
}

// ─── 공통 훅 반환 타입 ────────────────────────────────────
export interface UseQueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}
