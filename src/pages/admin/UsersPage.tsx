import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { Navigate } from 'react-router-dom'
import type { UserRole } from '../../types'

interface AccessCode {
  id: string
  access_code: string
  role: UserRole
  company: string | null
  label: string
  is_active: boolean
}

const ROLE_OPTIONS: UserRole[] = ['master', 'ceo', 'company']
const COMPANY_OPTIONS = ['셀바스에이아이', '셀바스헬스케어', '메디아나']
const ROLE_BADGE: Record<UserRole, string> = {
  master:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  ceo:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  company: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const EMPTY_FORM = {
  label: '', role: 'company' as UserRole, company: '셀바스에이아이', access_code: '', is_active: true,
}

export default function UsersPage() {
  const { user } = useAuth()
  if (user?.role !== 'master') return <Navigate to="/dashboard" replace />

  const [users,   setUsers]   = useState<AccessCode[]>([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ ...EMPTY_FORM })
  const [editId,  setEditId]  = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => { void loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('access_codes').select('*').order('role').order('label')
    setUsers((data ?? []) as AccessCode[])
    setLoading(false)
  }

  function loadRecord(rec: AccessCode) {
    setEditId(rec.id)
    setForm({
      label:       rec.label,
      role:        rec.role,
      company:     rec.company ?? '셀바스에이아이',
      access_code: rec.access_code,
      is_active:   rec.is_active,
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.access_code.length < 6) { setError('코드는 6자 이상이어야 합니다.'); return }
    setSaving(true)
    setError(null)

    const record = {
      label:       form.label,
      role:        form.role,
      company:     form.role === 'company' ? form.company : null,
      access_code: form.access_code,
      is_active:   form.is_active,
    }

    const { error: err } = editId
      ? await supabase.from('access_codes').update(record).eq('id', editId)
      : await supabase.from('access_codes').insert(record)

    setSaving(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
    resetForm()
    void loadUsers()
  }

  async function handleToggleActive(id: string, current: boolean) {
    if (!confirm(current ? '비활성화하시겠습니까?' : '활성화하시겠습니까?')) return
    await supabase.from('access_codes').update({ is_active: !current }).eq('id', id)
    void loadUsers()
  }

  async function handleDelete(id: string) {
    if (id === user?.sb_id) { alert('현재 로그인 계정은 삭제할 수 없습니다.'); return }
    if (!confirm('사용자를 삭제하시겠습니까?')) return
    await supabase.from('access_codes').delete().eq('id', id)
    void loadUsers()
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">사용자 관리</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + 사용자 추가
          </button>
        )}
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{editId ? '✏️ 수정 중' : '+ 사용자 추가'}</h3>
            <button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500">취소</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">표시 이름 *</label>
              <input type="text" value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                required placeholder="예: 홍길동 재무팀장"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">역할 *</label>
              <select value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {form.role === 'company' && (
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">소속 법인</label>
                <select value={form.company}
                  onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
                  {COMPANY_OPTIONS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">접근 코드 * (6자 이상)</label>
              <input type="text" value={form.access_code}
                onChange={e => setForm(f => ({ ...f, access_code: e.target.value }))}
                required placeholder="코드 입력"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="is_active" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              <label htmlFor="is_active" className="text-sm text-gray-600 dark:text-gray-300">활성</label>
            </div>
          </div>

          {error   && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">✓ 저장되었습니다.</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '사용자 추가'}
          </button>
        </form>
      )}

      {/* 사용자 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow">
        {loading ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">로딩 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {['이름', '역할', '소속법인', '접근코드', '상태', ''].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={`border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3 font-medium text-gray-800 dark:text-gray-100">
                      {u.label}
                      {u.id === user?.sb_id && (
                        <span className="ml-1.5 text-xs text-blue-500">(나)</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[u.role]}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{u.company ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400 dark:text-gray-500">{u.access_code}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-50 text-green-700 dark:text-emerald-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-600'}`}>
                        {u.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button onClick={() => loadRecord(u)} className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">수정</button>
                        <button onClick={() => handleToggleActive(u.id, u.is_active)}
                          className="text-xs text-amber-500 hover:text-amber-700">
                          {u.is_active ? '비활성화' : '활성화'}
                        </button>
                        <button onClick={() => handleDelete(u.id)} className="text-xs text-red-400 hover:text-red-600 dark:text-red-400">삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
