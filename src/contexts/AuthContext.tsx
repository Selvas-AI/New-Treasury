/**
 * AuthContext — Supabase Auth (이메일 + 비밀번호) 단일 인증
 *
 * ⛔ 접근코드(access_codes) 레거시 로그인은 2026-08-26 제거됐다.
 *   · 평문 코드를 anon 으로 대조하는 방식이라 access_codes 만 읽으면 master 로 로그인 가능
 *   · sessionStorage 에 프로필을 통째로 저장해 클라이언트에서 세션 위조가 가능
 *   · Supabase Auth 를 거치지 않아 DB 입장에선 계속 anon → RLS 를 authenticated 로 조일 수 없었다
 *   되살리지 말 것. 계정 추가는 사용자 관리에서 이메일 등록 → '최초 계정 설정' 경로를 쓴다.
 *
 * ⚠ 개발 중 sessionStorage['treasury_user'] 주입으로 master 세션을 흉내내던 방법도
 *   함께 사라졌다. 개발/디버깅도 실제 계정으로 로그인할 것.
 */
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import {
  supabase, restUpdate, restRpc, withTimeout, resetSupabaseClient,
  onSessionExpired, SESSION_EXPIRED_NOTICE_KEY,
} from '../lib/supabase'
import { AuthContext, MENU_DEFAULTS, ACTION_DEFAULTS } from './auth'
import type { TreasuryUser, Company, UserRole, SectionKey } from '../types'
import { useCompanies } from '../hooks/useCompanies'
import { ASSIGNABLE_SLUGS } from '../lib/navTree'

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
  must_change_password?: boolean | null   // 마이그레이션 전 DB엔 컬럼이 없을 수 있음 → optional
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
    must_change_password: row.must_change_password ?? false,
  }
}

// ── Provider ─────────────────────────────────────────────────
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user,            setUser]            = useState<TreasuryUser | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const { menusOf } = useCompanies()
  const [loading,         setLoading]         = useState(true)
  const [recoveryMode,    setRecoveryMode]    = useState(false)
  // Ref: onAuthStateChange 클로저 안에서 최신값 읽기 위해 ref 사용
  const userRef   = useRef<TreasuryUser | null>(null)
  useEffect(() => { userRef.current = user }, [user])

  useEffect(() => {
    let mounted = true

    // ── 1. Supabase 세션 localStorage에서 즉시 읽기 (네트워크 없음) ─
    {
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

    // ── 2. onAuthStateChange — 이벤트별 분기 ──────────────────
    // ⭐ 핵심: 세션이 유효한 한 절대 로그아웃하지 않는다.
    //   과거 버그: TOKEN_REFRESHED(1시간마다·탭 복귀 시) 마다 loadProfile 재조회 →
    //   순간 네트워크 지연/실패 시 setUser(null) → "튕기듯 로그아웃" 반복.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
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

      // ⭐ 비밀번호 찾기(recovery) 링크로 진입 — 세션은 수립되지만 "새 비밀번호 설정" 화면으로
      // 강제해야 함. 과거엔 이 이벤트를 별도 처리하지 않아 그냥 로그인된 것처럼 대시보드로
      // 흘러가 버려 사실상 비밀번호를 재설정할 방법이 없었다(2026-07-01 실사용 버그).
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)

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

  // ── 세션 만료 감지 (2026-09-02) ───────────────────────────
  // REST 헬퍼가 유효한 토큰을 못 찾으면 여기로 통지된다.
  // 프로필 캐시 덕분에 화면은 로그인 상태로 남지만 DB 요청은 authenticated 가 아니라
  // 저장은 RLS 로 거부되고(운전자금 입력 오류) 조회는 빈 값이 된다 → 로그인 화면으로 정리한다.
  // ⚠ 네트워크 순단 오탐으로 '튕기듯 로그아웃'이 재발하지 않도록, 세션이 정말 없을 때만 정리한다.
  useEffect(() => onSessionExpired(() => {
    void (async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 6000, '세션 확인')
        if (data.session) return          // 세션 유효 → 일시적 문제, 상태 유지
      } catch { return }                  // 확인 실패 → 유지
      clearProfileCache()
      try { sessionStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, '1') } catch { /* 무시 */ }
      setUser(null)
      setSelectedCompany(null)
    })()
  }), [])

  const currentCompany = useMemo<Company | null>(() => {
    if (!user) return null
    if (selectedCompany && hasCompanyCheck(user, selectedCompany)) return selectedCompany
    // 법인 미지정(=전체 접근) 계정 → 기본 첫 법인
    if (user.companies.length === 0 && !user.company) return selectedCompany ?? '셀바스에이아이'
    // 법인 지정 계정(master/admin 포함)은 지정된 첫 법인으로 — 미지정 법인으로 새지 않도록
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

  // ── 최초 계정 설정 (신규 사용자 비밀번호 등록) ──────────
  const register = useCallback(async (email: string, password: string): Promise<string | null> => {
    const lc = email.trim().toLowerCase()
    // ⚠ 로그인 전(anon) 경로다. treasury_users 를 직접 읽으면 그 테이블 정책을
    //   authenticated 전용으로 조일 수 없다 → 판정을 SECURITY DEFINER RPC 안으로 옮겼다.
    //   함수는 불리언과 사유만 돌려주고 프로필 행은 밖으로 내보내지 않는다.
    //   (docs/db/auth_registerable_rpc.sql)
    const { data: chk, error: chkErr } = await restRpc<{ registerable: boolean; reason: string | null }>(
      'is_registerable_email', { p_email: lc }, true,   // 로그인 전 호출 → anon 허용
    )
    if (chkErr) return chkErr.message
    const verdict = chk?.[0]
    if (!verdict)                          return '계정 확인에 실패했습니다. 잠시 후 다시 시도하세요.'
    if (verdict.reason === 'not_registered') return '등록되지 않은 이메일입니다. 관리자에게 계정 생성을 요청하세요.'
    if (verdict.reason === 'inactive')       return '비활성화된 계정입니다. 관리자에게 문의하세요.'
    if (!verdict.registerable)               return '계정 설정을 진행할 수 없습니다. 관리자에게 문의하세요.'
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
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return error ? error.message : null
  }, [])

  // ── 비밀번호 변경 (recovery 세션 진입 후 새 비밀번호 설정 / 강제변경 정책 공용) ──
  const updatePassword = useCallback(async (newPassword: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return error.message
    // must_change_password 플래그 해제 — 컬럼 미마이그레이션 DB에서도 실패하지 않도록 무시 가능한 에러로 처리
    const email = userRef.current?.email
    if (email) {
      await restUpdate('treasury_users', { must_change_password: false }, { email })
      setUser(u => u ? { ...u, must_change_password: false } : u)
    }
    setRecoveryMode(false)
    return null
  }, [])

  // ── 로그아웃 ────────────────────────────────────────────
  const logout = useCallback(async () => {
    clearProfileCache()
    setUser(null)
    setSelectedCompany(null)
    await supabase.auth.signOut()
  }, [])

  // 현재 법인의 표시 메뉴 (null = 전체). useCompanies 는 모듈 캐시 + 리스너 구조라
  // 캐시가 나중에 채워져도 여기서 재렌더가 일어난다 — 비훅 헬퍼를 쓰면 첫 로드에
  // 필터가 적용되지 않는다.
  const companyMenus = menusOf(currentCompany)

  // ── 권한 헬퍼 ──────────────────────────────────────────
  const canEdit    = useCallback(() => !!user && user.role !== 'viewer' && user.role !== 'ceo', [user])
  const canDelete  = useCallback(() => !!user && (user.role === 'master' || user.can_delete), [user])
  const canApprove = useCallback(() => !!user && (user.role === 'master' || user.role === 'admin' || user.can_approve), [user])

  const hasMenu = useCallback((slug: string): boolean => {
    if (!user) return false
    // ① 법인별 메뉴 구성 (companies.menus) — 권한이 아니라 표시 필터다.
    //    법인 자금 사정상 쓰지 않는 메뉴를 숨겨 노이즈를 줄이는 용도라 master 에게도 적용한다
    //    (숨긴 사람이 곧 master이고, 회사 관리에서 언제든 되돌릴 수 있다).
    //    ⚠ 관리 섹션(admin)은 법인과 무관하므로 대상에서 제외한다 — 여기 걸리면
    //      회사 관리 자체에 못 들어가 설정을 되돌릴 수 없게 된다.
    if (companyMenus && ASSIGNABLE_SLUGS.includes(slug) && !companyMenus.includes(slug)) return false
    // ② 사용자 권한
    if (user.role === 'master') return true
    const allowed = user.menus ?? MENU_DEFAULTS[user.role] ?? MENU_DEFAULTS['editor'] ?? []
    return allowed.includes('*') || allowed.includes(slug)
  }, [user, companyMenus])

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

  const setCurrentCompany = useCallback((c: Company | null) => setSelectedCompany(c), [])

  // Provider value 메모이즈 — 인라인 객체는 매 렌더 새 참조라 모든 useAuth 소비처가
  // 불필요하게 리렌더됨(앱 전반 성능·상태 안정성 저하). 의존값만 바뀔 때 갱신.
  const ctxValue = useMemo(() => ({
    user, currentCompany, loading,
    login, register, resetPassword, logout,
    recoveryMode, updatePassword,
    setCurrentCompany,
    canEdit, canDelete, canApprove, hasMenu, hasCompany, hasCategory, canAction,
  }), [
    user, currentCompany, loading,
    login, register, resetPassword, logout,
    recoveryMode, updatePassword, setCurrentCompany,
    canEdit, canDelete, canApprove, hasMenu, hasCompany, hasCategory, canAction,
  ])

  return (
    <AuthContext.Provider value={ctxValue}>
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
