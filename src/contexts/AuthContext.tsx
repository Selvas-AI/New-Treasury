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
import { supabase, restUpdate, withTimeout, resetSupabaseClient } from '../lib/supabase'
import { AuthContext, MENU_DEFAULTS, ACTION_DEFAULTS } from './auth'
import type { TreasuryUser, Company, UserRole, SectionKey } from '../types'

const LEGACY_SESSION_KEY  = 'treasury_user'
const SB_AUTH_KEY = `sb-${import.meta.env.VITE_SUPABASE_URL?.match(/\/\/([^.]+)/)?.[1]}-auth-token`
// 프로필 캐시 — 네트워크 없이 즉시 복원, 새로고침 시 로그아웃 방지
const PROFILE_CACHE_KEY = 'treasury_profile_cache'

function saveProfileCache(profile: TreasuryUser): void {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)) } catch { /* 무시 */ }
}
function loadProfileCache(): TreasuryUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as TreasuryUser
  } catch { return null }
}
function clearProfileCache(): void {
  try { localStorage.removeItem(PROFILE_CACHE_KEY) } catch { /* 무시 */ }
}

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
  allowed_categories: unknown; action_permissions: unknown
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
    allowed_categories: (row.allowed_categories as TreasuryUser['allowed_categories']) ?? null,
    action_permissions: (row.action_permissions as TreasuryUser['action_permissions']) ?? null,
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
    menus:              null,             // 역할 기본값 사용
    can_delete:         row.role === 'master',
    can_approve:        row.role === 'master',
    allowed_categories: null,
    action_permissions: null,
  }
}

// ── Provider ─────────────────────────────────────────────────
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user,            setUser]            = useState<TreasuryUser | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [loading,         setLoading]         = useState(true)
  // Ref: onAuthStateChange 클로저 안에서 최신값 읽기 위해 ref 사용
  const legacyRef = useRef(false)
  const userRef   = useRef<TreasuryUser | null>(null)
  useEffect(() => { userRef.current = user }, [user])

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
      const cached = loadProfileCache()

      if (localSession) {
        // 캐시된 프로필이 있으면 즉시 복원 → 새로고침 시 로그아웃 방지
        if (cached && cached.sb_id === localSession.sub) {
          setUser(cached)
          setLoading(false)
        }
        // 백그라운드에서 최신 프로필 갱신 (캐시 없으면 loading 유지)
        withTimeout(loadProfile(localSession.email, localSession.sub), 8000, '세션 복원')
          .then(profile => {
            if (!mounted) return
            if (profile) {
              saveProfileCache(profile)
              setUser(profile)
            } else if (!cached) {
              // 캐시도 없고 프로필도 null → LoginPage
              setUser(null)
            }
            // 캐시로 이미 복원된 경우 profile=null이어도 로그아웃 안 함 (네트워크 실패)
            setLoading(false)
          })
          .catch(() => {
            if (!mounted) return
            // 타임아웃/오류: 캐시 있으면 유지, 없으면 LoginPage
            if (!cached) setUser(null)
            setLoading(false)
          })
      } else {
        // access_token 만료 or 없음 → getSession()으로 자동 갱신 시도
        // (refresh_token이 유효하면 Supabase SDK가 새 access_token 발급)
        if (cached) {
          // 캐시 프로필 즉시 복원하여 로그인 화면 flash 방지
          setUser(cached)
          setLoading(false)
        }
        supabase.auth.getSession()
          .then(async ({ data }) => {
            if (!mounted) return
            const session = data.session
            if (session?.user) {
              // 토큰 갱신 성공 → 프로필 재로드
              try {
                const profile = await withTimeout(
                  loadProfile(session.user.email!, session.user.id), 6000, '세션 갱신'
                )
                if (!mounted) return
                if (profile) { saveProfileCache(profile); setUser(profile) }
                else if (!cached) setUser(null)
              } catch {
                if (!mounted) return
                if (!cached) setUser(null)
              }
            } else {
              // refresh_token도 만료 → 진짜 로그아웃
              if (mounted) { clearProfileCache(); setUser(null) }
            }
            if (mounted) setLoading(false)
          })
          .catch(() => {
            if (!mounted) return
            // 네트워크 오류 → 캐시 있으면 유지
            if (!cached) setUser(null)
            setLoading(false)
          })
      }
    }

    // ── 안전장치: 8초 내 loading 미해제 시 강제 해제 ─
    const hardTimeout = window.setTimeout(() => { if (mounted) setLoading(false) }, 8000)

    // ── 3. onAuthStateChange — 이벤트별 분기 ──────────────────
    // ⭐ 핵심: 세션이 유효한 한 절대 로그아웃하지 않는다.
    //   과거 버그: TOKEN_REFRESHED(1시간마다·탭 복귀 시) 마다 loadProfile 재조회 →
    //   순간 네트워크 지연/실패 시 setUser(null) → "튕기듯 로그아웃" 반복.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted || legacyRef.current) return
      // INITIAL_SESSION 은 위 readLocalSession() 으로 이미 처리 → 건너뜀
      if (event === 'INITIAL_SESSION') return

      // 진짜 로그아웃(refresh token 만료·취소·명시적 signOut)일 때만 클리어
      if (event === 'SIGNED_OUT') {
        clearProfileCache()
        setUser(null)
        setSelectedCompany(null)
        return
      }

      // 토큰 자동 갱신: 세션 유효 → 아무 것도 하지 않음
      // (user 유지, 새 access_token 은 SDK가 localStorage에 자동 반영. 재조회·법인초기화 금지)
      if (event === 'TOKEN_REFRESHED') return

      // SIGNED_IN / USER_UPDATED 등:
      //  - 이미 로그인 상태면 재조회·법인초기화 안 함 (깜빡임·튕김 방지)
      //  - user가 없을 때(예: 비밀번호 재설정 리다이렉트)만 백그라운드 프로필 로드
      //  - 로드 실패/null 이어도 절대 setUser(null) 하지 않음 (세션은 유효 → 다음 새로고침에 반영)
      if (session?.user && !userRef.current) {
        try {
          const profile = await withTimeout(
            loadProfile(session.user.email!, session.user.id), 6000, '프로필 조회',
          )
          if (mounted && profile) { saveProfileCache(profile); setUser(profile) }
        } catch { /* 무시 — 세션 유효, 강제 로그아웃 금지 */ }
      }
    })

    return () => { mounted = false; window.clearTimeout(hardTimeout); subscription.unsubscribe() }
  }, [])

  const currentCompany = useMemo<Company | null>(() => {
    if (!user) return null
    if (selectedCompany && hasCompanyCheck(user, selectedCompany)) return selectedCompany
    // companies 미지정 계정 또는 master/admin → 기본 첫 법인
    if (user.companies.length === 0 && !user.company) return selectedCompany ?? '셀바스에이아이'
    if (user.role === 'master' || user.role === 'admin') return selectedCompany ?? '셀바스에이아이'
    return user.company ?? (user.companies[0] as Company | undefined) ?? null
  }, [user, selectedCompany])

  // ── 신규: 이메일 + 비밀번호 로그인 ──────────────────────
  // - signInWithPassword: 5s 네트워크 타임아웃 (fetchWithTimeout)
  // - loadProfile: withTimeout(6s) — wedge 상태에서도 최대 6초 후 에러 반환
  // - 타임아웃/네트워크 오류 감지 시: resetSupabaseClient() 후 1회 재시도
  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    async function attempt(): Promise<string | null> {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      })
      if (error) {
        if (error.message.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않습니다.'
        if (error.message.includes('Email not confirmed'))       return '이메일 인증이 필요합니다. 받은 메일함을 확인하세요.'
        // 네트워크/타임아웃 오류 → throw로 상위 catch에 전달 (재시도 대상)
        throw new Error(error.message)
      }
      if (data.user) {
        // loadProfile도 withTimeout으로 보호 — wedge 상태 시 무한 hang 차단
        const profile = await withTimeout(
          loadProfile(data.user.email!, data.user.id), 6000, '프로필 조회'
        )
        if (!profile) {
          await supabase.auth.signOut()
          return '접근 권한이 없습니다. 관리자에게 문의하세요.'
        }
        saveProfileCache(profile)
        setUser(profile)
      }
      return null
    }

    try {
      return await attempt()
    } catch {
      // 첫 번째 시도 실패(타임아웃·네트워크 오류) → 클라이언트 재생성 후 1회 재시도
      resetSupabaseClient()
      try {
        return await attempt()
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : '네트워크 오류'
        if (msg.includes('AbortError') || msg.includes('aborted') || msg.includes('시간 초과'))
          return '네트워크 응답 시간 초과. 잠시 후 다시 시도하거나 페이지를 새로고침하세요.'
        return msg
      }
    }
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
    clearProfileCache()
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

  // 자금일보 카테고리 접근 여부 (null=모두 허용 → 기존 동작 유지)
  const hasCategory = useCallback((direction: 'in' | 'out', code: string): boolean => {
    if (!user) return false
    if (user.role === 'master') return true
    const ac = user.allowed_categories
    if (ac === null) return true
    const list = ac[direction]
    if (list === null) return true
    return list.includes(code)
  }, [user])

  // 섹션별 작업 권한 (null=역할 기본값 → 기존 동작 유지)
  const canAction = useCallback((section: SectionKey, action: 'view' | 'write' | 'delete'): boolean => {
    if (!user) return false
    if (user.role === 'master') return true
    const roleDefaults = ACTION_DEFAULTS[user.role] ?? ACTION_DEFAULTS.viewer
    const custom = user.action_permissions
    const perms = custom !== null
      ? (custom[section] ?? roleDefaults[section])   // custom 우선, 섹션 미정의 시 role default
      : roleDefaults[section]
    return perms?.[action] ?? false
  }, [user])

  return (
    <AuthContext.Provider value={{
      user, currentCompany, loading,
      login, loginWithCode, register, resetPassword, logout,
      setCurrentCompany: (c) => setSelectedCompany(c),
      canEdit, canDelete, canApprove, hasMenu, hasCompany, hasCategory, canAction,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

function hasCompanyCheck(user: TreasuryUser, c: Company): boolean {
  // companies 배열이 비어있으면 역할에 관계없이 전체 법인 접근 허용
  if (user.companies.length === 0 && !user.company) return true
  if (user.role === 'master' || user.role === 'admin') {
    return user.companies.length === 0 || user.companies.includes(c)
  }
  return user.companies.includes(c) || user.company === c
}
