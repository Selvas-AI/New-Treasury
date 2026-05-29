import { useState, useMemo, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth'
import type { TreasuryUser, Company } from '../types'

const SESSION_KEY = 'treasury_user'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TreasuryUser | null>(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? (JSON.parse(stored) as TreasuryUser) : null
  })

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)

  const currentCompany = useMemo<Company | null>(() => {
    if (!user) return null
    if (selectedCompany) return selectedCompany
    if (user.role === 'company' && user.company) return user.company as Company
    return '셀바스에이아이'
  }, [user, selectedCompany])

  async function login(code: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('access_codes')
      .select('*')
      .eq('access_code', code.trim())
      .eq('is_active', true)
      .single()

    if (error || !data) return '접근 코드가 올바르지 않습니다.'

    const treasuryUser: TreasuryUser = {
      role: data.role,
      company: data.company ?? null,
      label: data.label,
      code: data.access_code,
      sb_id: data.id,
    }

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(treasuryUser))
    setUser(treasuryUser)
    setSelectedCompany(null)
    return null
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setUser(null)
    setSelectedCompany(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, currentCompany, login, logout, setCurrentCompany: setSelectedCompany }}
    >
      {children}
    </AuthContext.Provider>
  )
}
