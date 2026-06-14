/**
 * AuthContext — 듀얼 인증 (Supabase Auth + 접근코드 레거시 fallback)
 *
 * 우선순위:
 *   1. Supabase Auth (이메일 + 비밀번호) — 신규 표준
 *   2. access_codes 테이블 코드 입력 — 레거시 fallback (기존 운영 사이트 호환)
 *
 * 세션 복원 순서:
 *   Supabase Auth 세션 확인 → 없으면 sessionStorage 레거시 확인
 *
 * 마이그레이션 완료 후: loginWithCode 제거, LoginPage 레거시 탭 제거
 */
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { supabase, restUpdate } from '../lib/supabase'
import { AuthContext, MENU_DEFAULTS } from './auth'
import type { TreasuryUser, Company, UserRole } from '../types'

const LEGACY_SESSION_KEY  = 'treasury_user'
const SB_AUTH_KEY = `sb-${import.meta.env.VITE_SUPABASE_URL?.match(/\/\/([^.]+)/)?.[1]}-auth-token`

// localStorage에서 Supabase 세션을 직접 읽어 반환 (네트워크 없음, 토큰 유효성만 확인)
function readLocalSession(): { email: string; sub: string } | null {
  try {
    const raw = localStorage.getItem(SB_AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { access_token?: string; expires_at?: number }
    if (!parsed.access_token || !parsed.expires_at) return null
    if (parsed.expires_at < Math.floor(Date.now() / 1000)) return null  // 만료됨
    // JWT payload 디코딩 (네트워크 불필요)
    const payload = JSON.parse(atob(parsed.access_token.split('.')[1])) as { email?: string; sub?: string }
    if (!payload.email || !payload.sub) return null
    return { email: payload.email, sub: payload.sub }
  } catch { return null }
}

// ── treasury_users 프로필 로드 (신규 Supabase Auth 경로) ──────
interface TreasuryUserRow {
  id: string; email: string; name: string; user_code: string
  role: string; companies: string[]; menus: string[] | null
  can_delete: boolean; can_approve: boolean; is_active: boolean
}

async function loadProfile(email: string, authId: string): Promise<TreasuryUser | null> {
  const { data, error } = await supabase
    .from('treasury_users').select('*')
    .eq('email', email.toLowerCase()).eq('is_active', true).single()
  if (error || !data) return null
  const row = data as TreasuryUserRow
  // 최초 로그인 시 임시 UUID → auth.users.id 동기화 (REST — supabase-js wedge 방지)
  if (row.id !== authId) {
    await restUpdate('treasury_users', { id: authId }, { email: email.toLowerCase() })
  }
  const companies = (row.companies ?? []) as Company[]
  return {
    sb_id: authId, email: row.email, code: row.user_code, label: row.name,
    role: row.role as UserRole, company: companies[0] ?? null, companies,
    menus: row.menus ?? null, can_delete: row.can_delete, can_approve: row.can_approve,
  }
}

// ── access_codes 레거시 프로필 변환 ──────────────────────────
interface AccessCodeRow {
  id: string; access_code: string; role: string
  company: string | null; label: string; is_active: boolean
}

function mapLegacy(row: AccessCodeRow): TreasuryUser {
  const company = row.company as Company | null
  return {
    sb_id: row.id,
    email: '',                     // 레거시 — 이메일 없음
    code:  row.access_code,
    label: row.label,
    role:  row.role as UserRole,
    company,
    companies: company ? [company] : [],
    menus:       null,             // 역할 기본값 사용
    can_delete:  row.role === 'master',
    can_approve: row.role === 'master',
  }
}

// ── Provider ─────────────────────────────────────────────────
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user,            setUser]            = useState<TreasuryUser | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [loading,         setLoading]         = useState(true)
  // Ref: onAuthStateChange 클로저 안에서 최신값 읽기 위해 ref 사용
  const legacyRef = useRef(false)

  useEffect(() => {
    let mounted = true

    // ── 1. 레거시 sessionStorage 즉시 복원 (네트워크 없음) ─────
    const storedLegacy = sessionStorage.getItem(LEGACY_SESSION_KEY)
    if (storedLegacy) {
      try {
        const legacy = JSON.parse(storedLegacy) as AccessCodeRow
        setUser(mapLegacy(legacy))
        legacyRef.current = true
      } catch { sessionStorage.removeItem(LEGACY_SESSION_KEY) }
      setLoading(false)
    }

    // ── 2. Supabase 세션 localStorage에서 즉시 읽기 (네트워크 없음) ─
    if (!legacyRef.current) {
      const localSession = readLocalSession()
      if (localSession) {
        // 저장된 세션 있음 → 프로필 로드 완료까지 loading 유지 (로그인창 깜빡임 방지)
        loadProfile(localSession.email, localSession.sub)
          .then(profile => { if (mounted) { setUser(profile); setLoading(false) } })
          .catch(() => { if (mounted) setLoading(false) })  // 프로필 실패 → LoginPage
      } else {
        // 저장된 세션 없음 → 즉시 LoginPage 표시
        setLoading(false)
      }
    }

    // ── 안전장치: 5초 내 loading 미해제 시 강제 해제 (네트워크 행 대비) ─
    const hardTimeout = window.setTimeout(() => { if (mounted) setLoading(false) }, 5000)

    // ── 3. onAuthStateChange — 로그인/로그아웃/토큰갱신 후속처리 ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      // INITIAL_SESSION 은 위 readLocalSession() 으로 이미 처리 → 건너뜀
      if (event === 'INITIAL_SESSION') return

      if (session?.user && !legacyRef.current) {
        try {
          const profile = await loadProfile(session.user.email!, session.user.id)
          if (mounted) { setUser(profile); setSelectedCompany(null) }
        } catch { if (mounted) setUser(null) }
      } else if (!session && !legacyRef.current) {
        if (mounted) { setUser(null); setSelectedCompany(null) }
      }
    })

    return () => { mounted = false; window.clearTimeout(hardTimeout); subscription.unsubscribe() }
  }, [])

  const currentCompany = useMemo<Company | null>(() => {
    if (!user) return null
    if (selectedCompany && hasCompanyCheck(user, selectedCompany)) return selectedCompany
    if (user.role === 'master' || user.role === 'admin') return selectedCompany ?? '셀바스에이아이'
    return user.company ?? (user.companies[0] as Company | undefined) ?? null
  }, [user, selectedCompany])

  // ── 신규: 이메일 + 비밀번호 로그인 ──────────────────────
  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    })
    if (error) {
      if (error.message.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않습니다.'
      if (error.message.includes('Email not confirmed'))       return '이메일 인증이 필요합니다. 받은 메일함을 확인하세요.'
      if (error.message.includes('AbortError') || error.message.includes('aborted'))
        return '네트워크 응답 시간 초과 (12초). 잠시 후 다시 시도하세요.'
      return error.message
    }
    // signInWithPassword 성공 → 세션에서 직접 프로필 로드 (getUser() 추가 네트워크 호출 없음)
    if (data.user) {
      const profile = await loadProfile(data.user.email!, data.user.id)
      if (!profile) {
        await supabase.auth.signOut()
        return '접근 권한이 없습니다. 관리자에게 문의하세요.'
      }
      setUser(profile)
    }
    return null
  }, [])

  // ── 레거시: 접근 코드 로그인 (access_codes 테이블) ──────
  const loginWithCode = useCallback(async (code: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('access_codes').select('*')
      .eq('access_code', code.trim()).eq('is_active', true).single()
    if (error || !data) return '접근 코드가 올바르지 않습니다.'
    const row = data as AccessCodeRow
    // sessionStorage에 저장 (기존 방식 유지)
    sessionStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(row))
    legacyRef.current = true
    setUser(mapLegacy(row))
    setSelectedCompany(null)
    return null
  }, [])

  // ── 최초 계정 설정 (신규 사용자 비밀번호 등록) ──────────
  const register = useCallback(async (email: string, password: string): Promise<string | null> => {
    const lc = email.trim().toLowerCase()
    const { data: profile } = await supabase
      .from('treasury_users').select('id, is_active').eq('email', lc).single()
    if (!profile)           return '등록되지 않은 이메일입니다. 관리자에게 계정 생성을 요청하세요.'
    if (!profile.is_active) return '비활성화된 계정입니다. 관리자에게 문의하세요.'
    const { error } = await supabase.auth.signUp({ email: lc, password })
    if (error) {
      if (error.message.includes('already registered')) return '이미 등록된 이메일입니다. 로그인 탭을 이용하세요.'
      return error.message
    }
    return null
  }, [])

  // ── 비밀번호 재설정 ──────────────────────────────────────
  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/New-Treasury/reset-password`,
    })
    return error ? error.message : null
  }, [])

  // ── 로그아웃 (양쪽 세션 모두 클리어) ────────────────────
  const logout = useCallback(async () => {
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
    legacyRef.current = false
    setUser(null)
    setSelectedCompany(null)
    await supabase.auth.signOut()  // 레거시 모드면 no-op
  }, [])

  // ── 권한 헬퍼 ──────────────────────────────────────────
  const canEdit    = useCallback(() => !!user && user.role !== 'viewer' && user.role !== 'ceo', [user])
  const canDelete  = useCallback(() => !!user && (user.role === 'master' || user.can_delete), [user])
  const canApprove = useCallback(() => !!user && (user.role === 'master' || user.role === 'admin' || user.can_approve), [user])

  const hasMenu = useCallback((slug: string): boolean => {
    if (!user) return false
    if (user.role === 'master') return true
    const allowed = user.menus ?? MENU_DEFAULTS[user.role] ?? MENU_DEFAULTS['editor'] ?? []
    return allowed.includes('*') || allowed.includes(slug)
  }, [user])

  const hasCompany = useCallback((c: Company): boolean => {
    if (!user) return false
    return hasCompanyCheck(user, c)
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, currentCompany, loading,
      login, loginWithCode, register, resetPassword, logout,
      setCurrentCompany: (c) => setSelectedCompany(c),
      canEdit, canDelete, canApprove, hasMenu, hasCompany,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

function hasCompanyCheck(user: TreasuryUser, c: Company): boolean {
  if (user.role === 'master' || user.role === 'admin') {
    return user.companies.length === 0 || user.companies.includes(c)
  }
  return user.companies.includes(c) || user.company === c
}
