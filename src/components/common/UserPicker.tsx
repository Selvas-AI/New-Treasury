/**
 * UserPicker — 법인별 사용자 선택 드롭다운
 * createPortal + position:fixed 로 어떤 overflow 조상에도 클리핑되지 않음.
 * 리스트 컨테이너는 Tailwind 대신 인라인 스타일로 height/overflow 보장.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  value: string
  onChange: (code: string, label: string) => void
  placeholder?: string
  className?: string
}

interface DropdownPos { top: number; left: number; width: number }

const ROLE_LABEL: Record<string, string> = {
  master: '마스터', admin: '관리자', editor: '편집자', viewer: '뷰어',
}

export default function UserPicker({ company, value, onChange, placeholder = '사용자를 선택하세요', className = '' }: Props) {
  const [users, setUsers]     = useState<UserRow[]>([])
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [loading, setLoading] = useState(false)
  const [pos, setPos]         = useState<DropdownPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('treasury_users')
      .select('user_code, name, email, role, companies, can_approve')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          setUsers((data as UserRow[]).filter(u =>
            u.companies.length === 0 || u.companies.includes(company)
          ))
        }
        setLoading(false)
      })
  }, [company])

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  function openDropdown() { calcPos(); setQuery(''); setOpen(true) }

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (document.getElementById('userpicker-portal')?.contains(t)) return
      setOpen(false)
    }
    function onScroll() { calcPos() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', calcPos)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', calcPos)
    }
  }, [open, calcPos])

  const selected = users.find(u => u.user_code === value)
  const filtered = !query.trim() ? users : users.filter(u => {
    const q = query.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.user_code.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  function initials(n: string) { return n.slice(0, 1) }
  function roleCls(r: string) {
    if (r === 'master') return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    if (r === 'admin')  return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    if (r === 'editor') return 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    return 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'
  }

  const portal = open && pos ? createPortal(
    <div
      id="userpicker-portal"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 99999,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
      className="bg-white dark:bg-slate-800 dark:border-slate-600"
    >
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
      {/* 목록 — 인라인 스타일로 height/overflow 보장 */}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">
            {query ? '검색 결과가 없습니다' : '해당 법인 사용자가 없습니다'}
          </p>
        ) : filtered.map(u => (
          <button
            key={u.user_code}
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(u.user_code, u.name); setOpen(false); setQuery('') }}
            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', background: u.user_code === value ? '#eff6ff' : 'transparent' }}
            className="hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-medium shrink-0">
              {initials(u.name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{u.name}</div>
              <div className="text-[10px] text-gray-400 dark:text-slate-400 truncate font-mono">{u.user_code} · {u.email}</div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${roleCls(u.role)}`}>
              {ROLE_LABEL[u.role] ?? u.role}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? setOpen(false) : openDropdown()}
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
            <span className="font-mono text-[10px] text-blue-400">{selected.user_code}</span>
          </>
        ) : (
          <span className="flex-1 text-left">{loading ? '로딩 중…' : placeholder}</span>
        )}
        <span className="text-gray-400 shrink-0">{open ? '▴' : '▾'}</span>
      </button>
      {portal}
    </div>
  )
}
