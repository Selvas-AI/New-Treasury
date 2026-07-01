/**
 * ChangePasswordForm — 새 비밀번호 설정 폼 (공용)
 *
 * 사용처:
 *   1. ResetPasswordPage — 이메일 "비밀번호 찾기" 링크로 진입한 recovery 세션에서 새 비밀번호 설정
 *   2. ForcePasswordChangeGate — master가 초기화한 임시 비밀번호(selvas11@) 최초 로그인 시 강제 변경
 *
 * onSubmit은 AuthContext.updatePassword를 그대로 전달받아 사용한다.
 */
import { useState, type FormEvent } from 'react'

const inputCls =
  'w-full border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm ' +
  'bg-gray-50 dark:bg-slate-800/60 text-gray-800 dark:text-gray-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-gray-800 transition-colors ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500'

export default function ChangePasswordForm({
  onSubmit, submitLabel = '비밀번호 변경', onSuccess,
}: {
  onSubmit: (newPassword: string) => Promise<string | null>
  submitLabel?: string
  onSuccess?: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)
  const [busy,     setBusy]     = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8)   { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (password !== confirm)  { setError('비밀번호가 일치하지 않습니다.'); return }
    setBusy(true)
    const err = await onSubmit(password)
    setBusy(false)
    if (err) { setError(err); return }
    setSuccess(true)
    onSuccess?.()
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">비밀번호가 변경되었습니다.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">새 비밀번호</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="8자 이상" autoFocus autoComplete="new-password" className={inputCls}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">새 비밀번호 확인</label>
        <input
          type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder="다시 입력" autoComplete="new-password" className={inputCls}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50 transition-colors">
        {busy ? '처리 중...' : submitLabel}
      </button>
    </form>
  )
}
