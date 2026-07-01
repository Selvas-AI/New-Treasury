import { createContext } from 'react'
import type { TreasuryUser, Company, SectionKey, SectionPermission } from '../types'

// 역할별 기본 허용 메뉴 slug
export const MENU_DEFAULTS: Record<string, string[]> = {
  master:  ['*'],
  admin:   ['dashboard','daily','input','invest','loans','equity','history','fx','policy'],
  editor:  ['dashboard','daily','input','invest','loans','equity','history','fx'],
  viewer:  ['dashboard','policy','invest','loans','equity','history','fx'],
}

// 역할별 섹션 기본 작업 권한 (action_permissions=null 일 때 fallback)
const _all  = (w: boolean, d: boolean): SectionPermission => ({ view: true, write: w, delete: d })
const _ro   = (): SectionPermission => ({ view: true, write: false, delete: false })

export const ACTION_DEFAULTS: Record<string, Partial<Record<SectionKey, SectionPermission>>> = {
  master: {
    operating: _all(true,true), invest: _all(true,true), loans: _all(true,true), equity: _all(true,true),
    daily_write: _all(true,true), daily_submit: _all(true,true), history: _all(true,false), issue_history: _all(true,false),
  },
  admin: {
    operating: _all(true,false), invest: _all(true,false), loans: _all(true,false), equity: _all(true,false),
    daily_write: _all(true,false), daily_submit: _all(true,false), history: _ro(), issue_history: _all(true,false),
  },
  editor: {
    operating: _all(true,false), invest: _all(true,false), loans: _ro(), equity: _all(true,false),
    daily_write: _all(true,false), daily_submit: _all(true,false), history: _ro(), issue_history: _ro(),
  },
  viewer: {
    operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(),
    daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro(),
  },
  // 레거시 역할 fallback
  ceo:     { operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(), daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro() },
  company: { operating: _ro(), invest: _ro(), loans: _ro(), equity: _ro(), daily_write: _ro(), daily_submit: _ro(), history: _ro(), issue_history: _ro() },
}

export interface AuthContextValue {
  user:           TreasuryUser | null
  currentCompany: Company | null
  loading:        boolean

  // 인증
  login:          (email: string, password: string) => Promise<string | null>
  loginWithCode:  (code: string) => Promise<string | null>   // 레거시 fallback
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
