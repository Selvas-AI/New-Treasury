/**
 * LoginPage — 듀얼 인증 로그인
 *
 * 탭 1: 이메일 + 비밀번호 (Supabase Auth)
 * 탭 2: 최초 계정 설정 (신규 사용자 비밀번호 등록)
 * 탭 3: 비밀번호 찾기
 *
 * ⛔ 접근 코드(access_codes) 로그인은 2026-08-26 제거됐다.
 *   평문 코드를 anon 으로 대조하는 방식이라 access_codes 테이블만 읽으면
 *   누구나 master 로 로그인할 수 있었고, Supabase Auth 를 거치지 않아
 *   DB 입장에서는 계속 anon 이었다(= RLS 를 authenticated 로 조일 수 없었다).
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { consumeSessionExpiredNotice } from '../lib/supabase'

type Mode = 'login' | 'register' | 'reset'

const TABS: { mode: Mode; icon: string; label: string }[] = [
  { mode: 'login',    icon: '✉️', label: '이메일 로그인' },
  { mode: 'register', icon: '🆕', label: '최초 설정'    },
  { mode: 'reset',    icon: '🔒', label: '비밀번호 찾기' },
]

export default function LoginPage() {
  const { user, loading, login, register, resetPassword } = useAuth()
  const [mode,     setMode]     = useState<Mode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  // 세션 만료로 자동 로그아웃된 경우 사유를 알려준다 (마운트 1회 소비)
  const [info,     setInfo]     = useState(() =>
    consumeSessionExpiredNotice() ? '세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.' : '')
  const [busy,     setBusy]     = useState(false)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-sm text-gray-400 animate-pulse">로딩 중…</div>
    </div>
  )
  if (user) return <Navigate to="/dashboard" replace />

  function switchMode(m: Mode) {
    setMode(m); setError(''); setInfo('')
    setPassword(''); setConfirm('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setInfo('')
    setBusy(true)

    try {
      if (mode === 'login') {
        if (!email.trim()) { setError('이메일을 입력하세요.'); return }
        const err = await login(email, password)
        if (err) setError(err)

      } else if (mode === 'register') {
        if (!email.trim())       { setError('이메일을 입력하세요.'); return }
        if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
        if (password !== confirm) { setError('비밀번호가 일치하지 않습니다.'); return }
        const err = await register(email, password)
        if (err) { setError(err) } else {
          setInfo('계정이 생성되었습니다. 이제 로그인하세요.')
          switchMode('login')
        }

      } else {
        if (!email.trim()) { setError('이메일을 입력하세요.'); return }
        const err = await resetPassword(email)
        if (err) { setError(err) } else {
          setInfo('비밀번호 재설정 링크를 이메일로 발송했습니다.')
        }
      }
    } catch (e) {
      setError(e instanceof Error && e.name === 'AbortError'
        ? '네트워크 응답 시간 초과 (12초). 인터넷 연결을 확인하거나 잠시 후 다시 시도하세요.'
        : '오류가 발생했습니다. 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm ' +
    'bg-gray-50 dark:bg-slate-800/60 text-gray-800 dark:text-gray-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-gray-800 transition-colors ' +
    'placeholder:text-gray-400 dark:placeholder:text-gray-500'

  const btnLabel: Record<Mode, string> = {
    login:    '로그인',
    register: '계정 설정',
    reset:    '재설정 링크 발송',
  }

  const btnColor: Record<Mode, string> = {
    login:    'bg-blue-600 hover:bg-blue-700',
    register: 'bg-emerald-600 hover:bg-emerald-700',
    reset:    'bg-gray-600 hover:bg-gray-700',
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">

        {/* 헤더 */}
        <div className="px-8 pt-8 pb-5 text-center border-b border-gray-100 dark:border-gray-800">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white text-lg mb-3">
            🏦
          </div>
          <h1 className="text-lg font-bold tracking-[0.2em] text-gray-800 dark:text-gray-100 uppercase">
            SELVAS TREASURY
          </h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">통합 자금 모니터링 시스템</p>
        </div>

        {/* 탭 — 탭 수만큼 균등 분할 (grid-cols-2 고정이면 3탭에서 빈 칸이 생긴다) */}
        <div
          className="grid border-b border-gray-100 dark:border-gray-800"
          style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
        >
          {TABS.map(({ mode: m, icon, label }) => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                aria-current={active ? 'page' : undefined}
                className={
                  'relative flex flex-col items-center justify-center gap-1.5 px-1 py-3.5 ' +
                  'text-[11px] font-medium whitespace-nowrap transition-colors ' +
                  (active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50/70 dark:hover:bg-slate-800/40')
                }
              >
                <span className="text-base leading-none">{icon}</span>
                <span>{label}</span>
                {/* 선택 표시는 탭 하단 전체 폭 밑줄 — 레이아웃을 밀지 않도록 absolute */}
                <span
                  className={
                    'absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors ' +
                    (active ? 'bg-blue-500' : 'bg-transparent')
                  }
                />
              </button>
            )
          })}
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="px-8 py-6 flex flex-col gap-3.5">

          {/* 이메일 (로그인 / 최초설정 / 비밀번호찾기) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
              autoFocus
              className={inputCls}
            />
          </div>

          {/* 비밀번호 (로그인 / 최초설정) */}
          {(mode === 'login' || mode === 'register') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">
                비밀번호
                {mode === 'register' && <span className="text-gray-400 font-normal"> (8자 이상)</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? '새 비밀번호 (8자 이상)' : '비밀번호'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className={inputCls}
              />
            </div>
          )}

          {/* 비밀번호 확인 (최초설정) */}
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">비밀번호 확인</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="비밀번호 재입력"
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
          )}

          {/* 안내 문구 */}
          {mode === 'register' && (
            <div className="flex items-start gap-2 text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-xl px-3 py-2.5">
              <span className="mt-px shrink-0">ℹ</span>
              <span>관리자가 사전 등록한 이메일만 계정 설정이 가능합니다.</span>
            </div>
          )}
          {mode === 'reset' && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
              가입된 이메일로 비밀번호 재설정 링크를 발송합니다.
            </p>
          )}

          {/* 오류 / 성공 */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl px-3 py-2.5">
              <span className="mt-px shrink-0">✕</span>
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-3 py-2.5">
              <span className="mt-px shrink-0">✓</span>
              <span>{info}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className={`mt-1 w-full ${btnColor[mode]} disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors shadow-sm`}
          >
            {busy ? '처리 중…' : btnLabel[mode]}
          </button>
        </form>

        <div className="px-8 pb-5 text-center">
          <p className="text-[10px] text-gray-300 dark:text-gray-700">
            계정 문의 · 시스템 관리자에게 연락하세요
          </p>
        </div>
      </div>
    </div>
  )
}

