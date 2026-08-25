import { createContext } from 'react'
import type { TreasuryUser, Company, SectionKey, SectionPermission } from '../types'

// 역할별 기본 허용 메뉴 slug
export const MENU_DEFAULTS: Record<string, string[]> = {
  // fx-regime 는 민감한 개발용 메뉴라 역할 기본값에 넣지 않는다.
  // fx-ledger(외화 원장)는 세션26차 4일차 통폐합 시 기존 외화매매거래 수준(기본 노출)으로
  // 격상됐다 — 사용자 확인(2026-08-19).
  // master는 hasMenu()에서 항상 허용되고, 그 외 계정은 treasury_users.menus에 명시돼야 한다.
  master:  ['*'],
  admin:   ['dashboard','daily','input','invest','loans','equity','history','fx','fx-ledger','policy'],
  editor:  ['dashboard','daily','input','invest','loans','equity','history','fx','fx-ledger'],
  viewer:  ['dashboard','policy','invest','loans','equity','history','fx','fx-ledger'],
}

// 역할별 섹션 기본 작업 권한 (action_permissions=null 일 때 fallback)
const _all  = (w: boolean, d: boolean): SectionPermission => ({ view: true, write: w, delete: d })
const _ro   = (): SectionPermission => ({ view: true, write: false, delete: false })

export const ACTION_DEFAULTS: Record<string, Partial<Record<SectionKey, SectionPermission>>> = {
  master: {
    operating: _all(true,true), invest: _all(true,true), loans: _all(true,true), equity: _all(true,true),
    daily_write: _all(true,true), daily_submit: _all(true,true), history: _all(true,false), issue_history: _all(true,false),
    fx_trade: _all(true,false), policy: _all(true,true),
  },
  admin: {
    operating: _all(true,false), invest: _all(true,false), loans: _all(true,false), equity: _all(true,false),
    daily_write: _all(true,false), daily_submit: _all(true,false), history: _ro(), issue_history: _all(true,false),
    // 외화매매거래: 기존 동작(canEdit=true → 완료 처리 가능) 유지를 위해 write 기본 허용
    fx_trade: _all(true,false),
    // 기본은 조회만(기존 동작 유지) — master가 사용자별로 입력·수정 권한을 개별 부여 가능(action_permissions)
    policy: _ro(),
  },
  editor: {
    operating: _all(true,false), invest: _all(true,false), loans: _ro(), equity: _all(true,false),
    daily_write: _all(true,false), daily_submit: _all(true,false), history: _ro(), issue_history: _ro(),
    fx_trade: _all(true,false), policy: _ro(),
  },
  viewer: {
    operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(),
    daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro(),
    fx_trade: _ro(), policy: _ro(),
  },
  // 레거시 역할 fallback
  ceo:     { operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(), daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro(), fx_trade: _ro(), policy: _ro() },
  company: { operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(), daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro(), fx_trade: _ro(), policy: _ro() },
}

export interface AuthContextValue {
  user:           TreasuryUser | null
  currentCompany: Company | null
  loading:        boolean

  // 인증
  login:          (email: string, password: string) => Promise<string | null>
  register:       (email: string, password: string) => Promise<string | null>
  resetPassword:  (email: string) => Promise<string | null>
  logout:         () => Promise<void>

  // 비밀번호 변경 — 비밀번호 찾기(recovery) 링크 진입 시 / 강제 변경 정책 모두 이 함수 사용
  recoveryMode:   boolean   // true = 이메일 "비밀번호 찾기" 링크로 진입해 세션이 막 수립된 상태
  updatePassword: (newPassword: string) => Promise<string | null>

  // 법인 전환
  setCurrentCompany: (company: Company) => void

  // 권한 헬퍼
  canEdit:      () => boolean
  canDelete:    () => boolean
  canApprove:   () => boolean
  hasMenu:      (slug: string) => boolean
  hasCompany:   (c: Company)  => boolean
  // 세분화 권한 (null=role default → 기존 동작 유지)
  hasCategory:  (direction: 'in' | 'out', code: string) => boolean
  canAction:    (section: SectionKey, action: 'view' | 'write' | 'delete') => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
