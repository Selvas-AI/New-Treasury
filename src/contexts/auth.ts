import { createContext } from 'react'
import type { TreasuryUser, Company } from '../types'

export interface AuthContextValue {
  user: TreasuryUser | null
  currentCompany: Company | null
  login: (code: string) => Promise<string | null>
  logout: () => void
  setCurrentCompany: (company: Company) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
