import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

export default function MyCodePage() {
  const { user, logout } = useAuth()

  const [newCode,     setNewCode]     = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newCode.length < 6)          { setError('코드는 6자 이상이어야 합니다.'); return }
    if (newCode !== confirmCode)      { setError('새 코드가 일치하지 않습니다.'); return }
    if (newCode === user?.code)       { setError('현재 코드와 동일합니다.'); return }

    setSaving(true)
    const { error: err } = await supabase
      .from('access_codes')
      .update({ access_code: newCode })
      .eq('id', user?.sb_id ?? '')

    setSaving(false)
    if (err) { setError(err.message); return }

    setSuccess(true)
    setTimeout(() => {
      logout()   // 코드 변경 후 재로그인 유도
    }, 2000)
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h2 className="text-lg font-bold text-gray-800">코드 변경</h2>

      <div className="bg-white rounded-xl shadow p-6 space-y-5">
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">현재 계정</p>
          <p className="text-sm font-semibold text-gray-800">{user?.label}</p>
          <p className="text-xs text-gray-400">역할: {user?.role}</p>
        </div>

        {success ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
            <p className="text-sm font-semibold text-emerald-700">✓ 코드가 변경되었습니다.</p>
            <p className="text-xs text-emerald-600 mt-1">보안을 위해 다시 로그인해주세요.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">새 접근 코드 *</label>
              <input
                type="password"
                value={newCode}
                onChange={e => setNewCode(e.target.value)}
                placeholder="6자 이상"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">새 코드 확인 *</label>
              <input
                type="password"
                value={confirmCode}
                onChange={e => setConfirmCode(e.target.value)}
                placeholder="위 코드 재입력"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '변경 중...' : '코드 변경'}
            </button>
          </form>
        )}

        <p className="text-xs text-gray-400 text-center">
          변경 후 자동으로 로그아웃되며 새 코드로 다시 로그인해야 합니다.
        </p>
      </div>
    </div>
  )
}
