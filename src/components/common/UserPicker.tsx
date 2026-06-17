/**
 * UserPicker — 법인별 사용자 선택 드롭다운
 * treasury_users 에서 해당 법인 소속 활성 사용자를 로드해 선택할 수 있는 컴포넌트.
 */
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface UserRow {
  user_code: string
  name: string
  email: string
  role: string
  companies: string[]
  can_approve: boolean
}

interface Props {
  company: string
  value: string           // 현재 선택된 user_code
  onChange: (code: string, label: string) => void
  placeholder?: string
  className?: string
}

const ROLE_LABEL: Record<string, string> = {
  master: '마스터', admin: '관리자', editor: '편집자', viewer: '뷰어',
}

export default function UserPicker({ company, value, onChange, placeholder = '사용자를 선택하세요', className = '' }: Props) {
  const [users, setUsers]       = useState<UserRow[]>([])
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [loading, setLoading]   = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('treasury_users')
      .select('user_code, name, email, role, companies, can_approve')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          const filtered = (data as UserRow[]).filter(u =>
            u.companies.length === 0 || u.companies.includes(company)
          )
          setUsers(filtered)
        }
        setLoading(false)
      })
  }, [company])

  // 외부 클릭 닫기
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const selected = users.find(u => u.user_code === value)
  const filtered = users.filter(u => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.user_code.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  function initials(name: string) {
    return name.slice(0, 1)
  }

  function roleCls(role: string) {
    if (role === 'master') return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    if (role === 'admin')  return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    if (role === 'editor') return 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    return 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {/* 트리거 */}
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className={`w-full flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 ${
          selected
            ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            : 'border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 text-gray-400 dark:text-slate-400'
        }`}
      >
        {selected ? (
          <>
            <span className="w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center text-[10px] font-medium shrink-0">
              {initials(selected.name)}
            </span>
            <span className="font-medium flex-1 text-left truncate">{selected.name}</span>
            <span className="font-mono text-[10px] text-blue-400 dark:text-blue-400">{selected.user_code}</span>
          </>
        ) : (
          <span className="flex-1 text-left">{loading ? '로딩 중…' : placeholder}</span>
        )}
        <span className="text-gray-400 shrink-0">▾</span>
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg overflow-hidden">
          {/* 검색 */}
          <div className="px-2.5 py-2 border-b border-gray-100 dark:border-slate-700">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="이름 · 코드 · 이메일 검색…"
              className="w-full text-xs bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* 목록 */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">
                {query ? '검색 결과가 없습니다' : '해당 법인 사용자가 없습니다'}
              </p>
            ) : filtered.map(u => (
              <button
                key={u.user_code}
                type="button"
                onClick={() => { onChange(u.user_code, u.name); setOpen(false); setQuery('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors ${
                  u.user_code === value ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-medium shrink-0">
                  {initials(u.name)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{u.name}</div>
                  <div className="text-[10px] text-gray-400 dark:text-slate-400 truncate font-mono">{u.user_code} · {u.email}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${roleCls(u.role)}`}>
                  {ROLE_LABEL[u.role] ?? u.role}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
