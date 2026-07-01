/**
 * ForcePasswordChangeGate — master가 비밀번호를 초기화(임시 비밀번호 selvas11@)한
 * 계정이 로그인하면, 다른 화면 접근 전에 반드시 새 비밀번호를 설정하도록 강제한다.
 *
 * Layout에서 user.must_change_password === true 일 때 <Outlet/> 대신 이 화면을 렌더링.
 */
import { useAuth } from '../../hooks/useAuth'
import ChangePasswordForm from '../common/ChangePasswordForm'

export default function ForcePasswordChangeGate() {
  const { user, updatePassword, logout } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-8 pt-8 pb-5 text-center border-b border-gray-100 dark:border-gray-800">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500 text-white text-lg mb-3">
            🔑
          </div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">비밀번호 변경이 필요합니다</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {user?.label ?? ''} 님, 관리자가 초기화한 임시 비밀번호로 로그인했습니다.<br />
            계속 이용하려면 새 비밀번호를 설정해 주세요.
          </p>
        </div>

        <div className="px-8 py-6 space-y-4">
          <ChangePasswordForm onSubmit={updatePassword} submitLabel="비밀번호 설정하고 계속하기" />
          <button onClick={() => void logout()}
            className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-center">
            로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}
