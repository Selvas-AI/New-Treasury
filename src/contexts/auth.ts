import { createContext } from 'react'
import type { TreasuryUser, Company } from '../types'

// 역할별 기본 허용 메뉴 slug
export const MENU_DEFAULTS: Record<string, string[]> = {
  master:  ['*'],
  admin:   ['dashboard','daily','input','invest','loans','equity','history','fx','policy'],
  editor:  ['dashboard','daily','input','invest','loans','equity','history','fx'],
  viewer:  ['dashboard','invest','loans','equity','history','fx'],
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

  // 법인 전환
  setCurrentCompany: (company: Company) => void

  // 권한 헬퍼
  canEdit:    () => boolean
  canDelete:  () => boolean
  canApprove: () => boolean
  hasMenu:    (slug: string) => boolean
  hasCompany: (c: Company)  => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)
