/**
 * ResetPasswordPage — "비밀번호 찾기" 이메일 링크 도착 지점 (/reset-password)
 *
 * 흐름: LoginPage "비밀번호 찾기" → resetPassword(email) → Supabase가 recovery 메일 발송
 *   → 메일의 링크 클릭 → Supabase가 recovery 토큰 검증 후 이 경로로 리다이렉트하며
 *     URL 해시에 access_token 포함 → supabase-js가 자동으로 세션 수립 + PASSWORD_RECOVERY
 *     이벤트 발생 → AuthContext가 recoveryMode=true로 전환.
 *
 * ⚠️ Supabase 대시보드 Authentication → URL Configuration → Redirect URLs 에
 *   이 페이지의 정확한 URL(예: https://treasury.selvas.com/reset-password,
 *   http://localhost:5175/reset-password)이 등록돼 있어야 정상 동작한다.
 *   등록돼 있지 않으면 Supabase가 redirect_to를 Site URL(origin)로 잘라버려
 *   이 페이지에 도달하지 못한다 (2026-07-01 실사용 버그 원인).
 */
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import ChangePasswordForm from '../components/common/ChangePasswordForm'

export default function ResetPasswordPage() {
  const { recoveryMode, updatePassword, loading } = useAuth()
  const navigate = useNavigate()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="text-sm text-gray-400 animate-pulse">로딩 중…</div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-8 pt-8 pb-5 text-center border-b border-gray-100 dark:border-gray-800">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white text-lg mb-3">
            🔒
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">새 비밀번호 설정</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">SELVAS TREASURY</p>
        </div>

        <div className="px-8 py-6">
          {recoveryMode ? (
            <ChangePasswordForm
              onSubmit={updatePassword}
              submitLabel="비밀번호 설정 완료"
              onSuccess={() => setTimeout(() => navigate('/dashboard', { replace: true }), 1200)}
            />
          ) : (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-slate-300">
                유효하지 않거나 만료된 링크입니다.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                로그인 화면의 "비밀번호 찾기"에서 재설정 메일을 다시 요청해 주세요.
              </p>
              <button onClick={() => navigate('/login', { replace: true })}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
                로그인 화면으로 →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
