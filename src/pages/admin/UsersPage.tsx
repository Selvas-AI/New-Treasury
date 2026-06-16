/**
 * UsersPage — treasury_users 관리 (master 전용)
 *
 * 사용자 생성 흐름:
 *   1. 여기서 이메일 + 권한 프로필 등록 (사전 allowlist)
 *   2. 해당 이메일 소유자가 LoginPage "최초 계정 설정" 탭에서 비밀번호 설정
 *   3. 이후 일반 로그인
 */
import { useState, useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase, restInsert, restUpdate, restDelete } from '../../lib/supabase'
import { generateUUID } from '../../lib/format'
import { useCompanies } from '../../hooks/useCompanies'
import { ACTION_DEFAULTS } from '../../contexts/auth'
import type { UserRole, SectionKey, SectionPermission, CategoryPermissions } from '../../types'
const ROLES: { value: UserRole; label: string; desc: string; permissions: string[] }[] = [
  {
    value: 'master', label: '마스터', desc: '전체 권한 (사용자 관리 포함)',
    permissions: [
      '✅ 모든 메뉴 접근 (사용자 관리 포함)',
      '✅ 전체 법인 데이터 접근',
      '✅ 데이터 삭제 기본 허용',
      '✅ 결재 승인 기본 허용',
      '✅ 정책 파라미터 편집',
    ],
  },
  {
    value: 'admin', label: '관리자', desc: '데이터 입력·편집·결재 (사용자 관리 제외)',
    permissions: [
      '✅ 대부분 메뉴 접근 (사용자 관리 제외)',
      '✅ 자금정책·자금일보 접근',
      '✅ 데이터 입력·편집',
      '➕ 삭제·결재는 "추가 권한"으로 부여',
      '❌ 사용자 관리 불가',
    ],
  },
  {
    value: 'editor', label: '편집자', desc: '데이터 입력·편집 (삭제·결재 별도 설정)',
    permissions: [
      '✅ 운전·운용·차입·지분 입력 가능',
      '✅ 자금일보 작성 가능',
      '❌ 자금정책 메뉴 접근 불가',
      '➕ 삭제·결재는 "추가 권한"으로 부여',
      '❌ 사용자 관리 불가',
    ],
  },
  {
    value: 'viewer', label: '뷰어', desc: '읽기 전용',
    permissions: [
      '👁 모든 데이터 조회만 가능',
      '❌ 데이터 입력·편집·삭제 불가',
      '❌ 결재 승인 불가',
      '❌ 운전자금 입력·자금일보·정책 접근 불가',
      '❌ 사용자 관리 불가',
    ],
  },
]
const MENU_SLUGS = [
  { slug: 'dashboard', label: '통합상황판' },
  { slug: 'daily',     label: '자금일보'   },
  { slug: 'input',     label: '운전자금'   },
  { slug: 'invest',    label: '운용자금'   },
  { slug: 'loans',     label: '차입금'     },
  { slug: 'equity',    label: '지분투자'   },
  { slug: 'history',   label: '이력관리'   },
  { slug: 'fx',        label: '환율현황'   },
  { slug: 'policy',    label: '자금정책'   },
]
const ROLE_BADGE: Record<string, string> = {
  master:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  admin:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  editor:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  viewer:  'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  ceo:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  company: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

interface UserRow {
  id:                  string
  email:               string
  name:                string
  user_code:           string
  role:                UserRole
  companies:           string[]
  menus:               string[] | null
  can_delete:          boolean
  can_approve:         boolean
  is_active:           boolean
  created_at:          string
  allowed_categories:  CategoryPermissions | null
  action_permissions:  Partial<Record<SectionKey, SectionPermission>> | null
}

const EMPTY: Omit<UserRow, 'id' | 'created_at'> = {
  email: '', name: '', user_code: '', role: 'viewer',
  companies: [], menus: null,
  can_delete: false, can_approve: false, is_active: true,
  allowed_categories: null, action_permissions: null,
}

// ── 작업권한 섹션 정의 ──────────────────────────────────────
type ActionKey = 'view' | 'write' | 'delete'
interface SectionDef { key: SectionKey; label: string; group: string; disabled?: ActionKey[] }
const SECTIONS: SectionDef[] = [
  { key: 'operating',    label: '운전자금',  group: '자금 입력' },
  { key: 'invest',       label: '운용자금',  group: '자금 입력' },
  { key: 'loans',        label: '차입금',    group: '자금 입력' },
  { key: 'equity',       label: '지분투자',  group: '자금 입력' },
  { key: 'daily_write',  label: '일보 작성', group: '자금일보',  disabled: ['delete'] },
  { key: 'daily_submit', label: '결재 상신', group: '자금일보',  disabled: ['delete'] },
  { key: 'history',      label: '자금 이력', group: '이력 관리', disabled: ['write','delete'] },
  { key: 'issue_history',label: '이슈 이력', group: '이력 관리', disabled: ['delete'] },
]

// IN_CATEGORIES / OUT_CATEGORIES (ItemsSection과 동기화)
const IN_CAT_LABELS: { code: string; label: string }[] = [
  { code: 'ar_collection',   label: '매출채권 회수' },
  { code: 'other_receivable',label: '미수금 회수'   },
  { code: 'govt_fund',       label: '국책자금 회수' },
  { code: 'advance_in',      label: '선수금 입금'   },
  { code: 'invest_return',   label: '투자금 회수'   },
  { code: 'loan_drawdown',   label: '차입금 실행'   },
  { code: 'interest_income', label: '이자수익'      },
  { code: 'invest_eval_in',  label: '투자자산평가'  },
  { code: 'other_in',        label: '기타'          },
]
const OUT_CAT_LABELS: { code: string; label: string }[] = [
  { code: 'ap_payment',      label: '미지급금 지급'  },
  { code: 'trade_ap_payment',label: '외상매입금 지급' },
  { code: 'advance_out',     label: '선급금 지급'    },
  { code: 'invest_execute',  label: '투자 집행'      },
  { code: 'loan_repayment',  label: '차입금 상환'    },
  { code: 'interest_expense',label: '이자비용'       },
  { code: 'enote_payment',   label: '전자어음결제'   },
  { code: 'invest_eval_out', label: '투자자산평가'   },
  { code: 'other_out',       label: '기타'           },
]

function genCode(name: string): string {
  const upper = name.replace(/\s/g, '').toUpperCase().slice(0, 4)
  return upper + Math.floor(100 + Math.random() * 900)
}

export default function UsersPage() {
  const { user } = useAuth()
  const { names: companyNames, shortName } = useCompanies()

  const [rows,      setRows]      = useState<UserRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [form,      setForm]      = useState<Omit<UserRow, 'id' | 'created_at'>>({ ...EMPTY })
  const [customMenu,     setCustomMenu]     = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [success,        setSuccess]        = useState(false)

  // ── 세분화 권한 탭 상태 ────────────────────────────────────
  const [permTab,        setPermTab]        = useState<'menu' | 'category' | 'action'>('menu')
  // 카테고리 권한
  const [customCategory, setCustomCategory] = useState(false)
  const [allowedCatsIn,  setAllowedCatsIn]  = useState<string[]>([])
  const [allowedCatsOut, setAllowedCatsOut] = useState<string[]>([])
  // 작업 권한
  const [customAction,   setCustomAction]   = useState(false)
  const [actionPerms,    setActionPerms]    = useState<Partial<Record<SectionKey, SectionPermission>>>(() =>
    ACTION_DEFAULTS['editor'] as Partial<Record<SectionKey, SectionPermission>>
  )

  // ── 필터 상태 ─────────────────────────────────────────────
  const [filterCompany, setFilterCompany] = useState<string>('전체')
  const [filterRole,    setFilterRole]    = useState<string>('전체')
  const [filterStatus,  setFilterStatus]  = useState<string>('전체')
  const [searchText,    setSearchText]    = useState('')

  // 법인 칩 카운트 (전체 접근=빈 companies 포함)
  const companyCounts = useMemo(() => {
    const counts: Record<string, number> = { '전체': rows.length }
    companyNames.forEach(c => {
      counts[c] = rows.filter(r => r.companies.length === 0 || r.companies.includes(c)).length
    })
    return counts
  }, [rows, companyNames])

  // 필터 적용된 목록
  const filteredRows = useMemo(() => {
    let r = rows
    if (filterCompany !== '전체')
      r = r.filter(row => row.companies.length === 0 || row.companies.includes(filterCompany))
    if (filterRole !== '전체')
      r = r.filter(row => row.role === filterRole)
    if (filterStatus === '활성만')   r = r.filter(row =>  row.is_active)
    if (filterStatus === '비활성만') r = r.filter(row => !row.is_active)
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      r = r.filter(row =>
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.user_code.toLowerCase().includes(q),
      )
    }
    return r
  }, [rows, filterCompany, filterRole, filterStatus, searchText])

  useEffect(() => { void load() }, [])

  // 훅 호출 완료 후 권한 체크 (Rules of Hooks: 조건부 return은 훅 이후에)
  if (user?.role !== 'master') return <Navigate to="/dashboard" replace />

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('treasury_users').select('*').order('role').order('name')
      setRows((data ?? []) as UserRow[])
    } catch {
      setRows([])  // 타임아웃·네트워크 오류 → 빈 목록, 무한 로딩 방지
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY })
    setCustomMenu(false)
    setError(null)
    setShowForm(true)
  }

  function openEdit(row: UserRow) {
    setEditId(row.id)
    setForm({
      email:       row.email,
      name:        row.name,
      user_code:   row.user_code,
      role:        row.role,
      companies:   row.companies ?? [],
      menus:       row.menus,
      can_delete:  row.can_delete,
      can_approve: row.can_approve,
      is_active:   row.is_active,
      allowed_categories: row.allowed_categories,
      action_permissions: row.action_permissions,
    })
    setCustomMenu(row.menus !== null)
    // 세분화 권한 복원
    setPermTab('menu')
    const hasCatPerm = row.allowed_categories !== null
    setCustomCategory(hasCatPerm)
    setAllowedCatsIn(row.allowed_categories?.in ?? [])
    setAllowedCatsOut(row.allowed_categories?.out ?? [])
    const hasActPerm = row.action_permissions !== null
    setCustomAction(hasActPerm)
    setActionPerms(
      hasActPerm
        ? row.action_permissions!
        : (ACTION_DEFAULTS[row.role] ?? ACTION_DEFAULTS.editor) as Partial<Record<SectionKey, SectionPermission>>
    )
    setError(null)
    setShowForm(true)
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)
  }

  function resetForm() {
    setShowForm(false); setEditId(null); setError(null)
    setForm({ ...EMPTY }); setCustomMenu(false)
    setPermTab('menu')
    setCustomCategory(false); setAllowedCatsIn([]); setAllowedCatsOut([])
    setCustomAction(false)
    setActionPerms(ACTION_DEFAULTS['editor'] as Partial<Record<SectionKey, SectionPermission>>)
  }

  function setF<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function toggleCompany(c: string) {
    setForm(f => {
      const cur = f.companies ?? []
      return { ...f, companies: cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c] }
    })
  }

  function toggleMenu(slug: string) {
    setForm(f => {
      const cur = f.menus ?? []
      return { ...f, menus: cur.includes(slug) ? cur.filter(x => x !== slug) : [...cur, slug] }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.email.trim())     { setError('이메일을 입력하세요.'); return }
    if (!form.name.trim())      { setError('이름을 입력하세요.'); return }
    if (!form.user_code.trim()) { setError('사용자 코드를 입력하세요.'); return }

    const payload = {
      email:       form.email.trim().toLowerCase(),
      name:        form.name.trim(),
      user_code:   form.user_code.trim().toUpperCase(),
      role:        form.role,
      companies:   form.companies,
      menus:       customMenu ? (form.menus ?? []) : null,
      can_delete:  form.can_delete,
      can_approve: form.can_approve,
      is_active:   form.is_active,
      allowed_categories: customCategory
        ? { in: allowedCatsIn, out: allowedCatsOut }
        : null,
      action_permissions: customAction ? actionPerms : null,
    }

    setSaving(true)
    // raw fetch 기반 — supabase-js 403 wedge 회피, 12s 타임아웃 내장
    const { error: err } = editId
      ? await restUpdate('treasury_users', payload, { id: editId })
      : await restInsert('treasury_users', { ...payload, id: generateUUID() })

    setSaving(false)
    if (err) {
      if (err.message.includes('duplicate') || err.message.includes('unique')) {
        setError('이미 등록된 이메일 또는 사용자 코드입니다.')
      } else {
        setError(err.message)
      }
      return
    }

    setSuccess(true)
    setTimeout(() => setSuccess(false), 2500)
    resetForm()
    void load()
  }

  async function toggleActive(row: UserRow) {
    if (row.id === user?.sb_id && row.is_active) {
      alert('현재 로그인 계정은 비활성화할 수 없습니다.')
      return
    }
    const { error: err } = await restUpdate('treasury_users', { is_active: !row.is_active }, { id: row.id })
    if (err) { alert(`상태 변경 실패: ${err.message}`); return }
    void load()
  }

  async function handleDelete(row: UserRow) {
    if (row.id === user?.sb_id) { alert('현재 로그인 계정은 삭제할 수 없습니다.'); return }
    if (!confirm(`"${row.name}" 사용자를 삭제하시겠습니까?\n(Supabase Auth 계정은 별도로 삭제해야 합니다)`)) return
    const { error: err } = await restDelete('treasury_users', { id: row.id })
    if (err) { alert(`삭제 실패: ${err.message}`); return }
    void load()
  }

  const inputCls = 'w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* ── 사용자 관리 헤더 ──────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">사용자 관리</h2>
          <p className="text-xs text-gray-400 mt-0.5">등록된 이메일만 "최초 계정 설정"으로 로그인 가능합니다.</p>
        </div>
        {!showForm && (
          <button onClick={openNew}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + 사용자 추가
          </button>
        )}
      </div>

      {/* 성공 배너 */}
      {success && (
        <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 rounded-lg px-4 py-2.5">
          ✓ 저장되었습니다. 해당 이메일 소유자가 "최초 계정 설정" 탭에서 비밀번호를 설정하면 로그인 가능합니다.
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-xl shadow border border-gray-100 dark:border-slate-700 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {editId ? '✏️ 사용자 수정' : '+ 사용자 추가'}
            </h3>
            <button type="button" onClick={resetForm}
              className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500">취소</button>
          </div>

          {/* 기본 정보 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">이메일 <span className="text-red-400">*</span></label>
              <input type="email" value={form.email}
                onChange={e => setF('email', e.target.value)}
                placeholder="name@selvas.com" disabled={!!editId}
                className={inputCls + (editId ? ' opacity-60 cursor-not-allowed' : '')} />
              {!editId && <p className="text-[10px] text-gray-400 mt-1">이 이메일로 최초 계정 설정이 가능합니다.</p>}
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">표시 이름 <span className="text-red-400">*</span></label>
              <div className="flex gap-1.5">
                <input type="text" value={form.name}
                  onChange={e => setF('name', e.target.value)}
                  placeholder="홍길동" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">
                사용자 코드 <span className="text-red-400">*</span>
                <span className="text-gray-400 font-normal ml-1">(감사추적용)</span>
              </label>
              <div className="flex gap-1.5">
                <input type="text" value={form.user_code}
                  onChange={e => setF('user_code', e.target.value.toUpperCase())}
                  placeholder="HONG01" maxLength={8}
                  className={inputCls + ' font-mono uppercase'} />
                <button type="button"
                  onClick={() => setF('user_code', genCode(form.name))}
                  className="shrink-0 text-xs px-2 py-1.5 bg-gray-100 dark:bg-slate-700 rounded-lg text-gray-500 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap">
                  자동
                </button>
              </div>
            </div>
          </div>

          {/* 역할 */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-slate-300 mb-2">역할 <span className="text-red-400">*</span></label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {ROLES.map(r => (
                <label key={r.value}
                  className={`group relative flex flex-col gap-1 p-3 rounded-lg border-2 cursor-pointer transition-colors ${form.role === r.value ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-600 hover:border-blue-200 dark:hover:border-blue-700'}`}>
                  <input type="radio" name="role" value={r.value} checked={form.role === r.value}
                    onChange={() => setF('role', r.value)} className="sr-only" />
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ROLE_BADGE[r.value]}`}>{r.label}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 select-none">ℹ</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-slate-300 leading-snug">{r.desc}</span>
                  {/* 호버 시 상세 권한 툴팁 */}
                  <div className="absolute bottom-full left-0 mb-2 z-20 hidden group-hover:block w-56 bg-gray-900 dark:bg-slate-950 text-white rounded-lg shadow-xl p-3 pointer-events-none">
                    <p className="text-[11px] font-semibold mb-1.5 text-gray-200">{r.label} 권한 상세</p>
                    <ul className="space-y-1">
                      {r.permissions.map((p, i) => (
                        <li key={i} className="text-[10px] text-gray-300 leading-snug">{p}</li>
                      ))}
                    </ul>
                    {/* 툴팁 화살표 */}
                    <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-950" />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 법인 접근 */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-slate-300 mb-2">
              접근 허용 법인
              {(form.role === 'master' || form.role === 'admin') && form.companies.length === 0
                ? <span className="ml-2 text-blue-500 font-normal">전체 허용 (빈 선택)</span>
                : null}
            </label>
            <div className="flex gap-2 flex-wrap">
              {companyNames.map(c => (
                <label key={c}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${form.companies.includes(c) ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-200'}`}>
                  <input type="checkbox" checked={form.companies.includes(c)}
                    onChange={() => toggleCompany(c)} className="sr-only" />
                  {form.companies.includes(c) ? '✓ ' : ''}{c}
                </label>
              ))}
            </div>
            {(form.role === 'editor' || form.role === 'viewer') && form.companies.length === 0 && (
              <p className="text-[10px] text-amber-500 mt-1.5">⚠ editor/viewer는 법인을 1개 이상 선택해야 데이터에 접근할 수 있습니다.</p>
            )}
          </div>

          {/* 계정 플래그 */}
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'can_delete',  label: '삭제 허용' },
              { key: 'can_approve', label: '결재 승인 허용' },
              { key: 'is_active',   label: '계정 활성' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={form[key as keyof typeof form] as boolean}
                  onChange={e => setF(key as keyof typeof form, e.target.checked as never)}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700 dark:text-slate-100">{label}</span>
              </label>
            ))}
          </div>

          {/* ── 세분화 권한 탭 ────────────────────────────────── */}
          <div className="border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden">
            {/* 탭 바 */}
            <div className="flex border-b border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50">
              {(['menu','category','action'] as const).map((t, i) => {
                const labels = ['메뉴 접근', '카테고리 권한', '작업 권한']
                const badges = [
                  customMenu ? '커스텀' : null,
                  customCategory ? '커스텀' : null,
                  customAction ? '커스텀' : null,
                ]
                return (
                  <button key={t} type="button" onClick={() => setPermTab(t)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${permTab === t ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700'}`}>
                    {labels[i]}
                    {badges[i] && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">{badges[i]}</span>}
                  </button>
                )
              })}
            </div>

            {/* 탭1: 메뉴 접근 */}
            {permTab === 'menu' && (
              <div className="p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={customMenu}
                    onChange={e => { setCustomMenu(e.target.checked); if (!e.target.checked) setF('menus', null) }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-xs text-gray-600 dark:text-slate-300">커스텀 설정 (미선택 시 역할 기본값 적용)</span>
                </label>
                {customMenu && (
                  <div className="flex flex-wrap gap-2 pl-6">
                    {MENU_SLUGS.map(m => (
                      <label key={m.slug}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-xs transition-colors ${(form.menus ?? []).includes(m.slug) ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300'}`}>
                        <input type="checkbox" checked={(form.menus ?? []).includes(m.slug)}
                          onChange={() => toggleMenu(m.slug)} className="sr-only" />
                        {(form.menus ?? []).includes(m.slug) ? '✓ ' : ''}{m.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 탭2: 카테고리 권한 */}
            {permTab === 'category' && (
              <div className="p-4 space-y-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={customCategory}
                    onChange={e => {
                      setCustomCategory(e.target.checked)
                      if (e.target.checked) {
                        setAllowedCatsIn(IN_CAT_LABELS.map(c => c.code))
                        setAllowedCatsOut(OUT_CAT_LABELS.map(c => c.code))
                      }
                    }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-xs text-gray-600 dark:text-slate-300">커스텀 설정 (미선택 시 모든 카테고리 허용)</span>
                </label>
                {customCategory && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-2">입금 항목</p>
                      <div className="flex flex-wrap gap-2">
                        {IN_CAT_LABELS.map(c => {
                          const on = allowedCatsIn.includes(c.code)
                          return (
                            <label key={c.code}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-xs transition-colors ${on ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300'}`}>
                              <input type="checkbox" checked={on} onChange={() =>
                                setAllowedCatsIn(prev => on ? prev.filter(x => x !== c.code) : [...prev, c.code])
                              } className="sr-only" />
                              {on ? '✓ ' : ''}{c.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-2">출금 항목</p>
                      <div className="flex flex-wrap gap-2">
                        {OUT_CAT_LABELS.map(c => {
                          const on = allowedCatsOut.includes(c.code)
                          return (
                            <label key={c.code}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-xs transition-colors ${on ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300'}`}>
                              <input type="checkbox" checked={on} onChange={() =>
                                setAllowedCatsOut(prev => on ? prev.filter(x => x !== c.code) : [...prev, c.code])
                              } className="sr-only" />
                              {on ? '✓ ' : ''}{c.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 탭3: 작업 권한 매트릭스 */}
            {permTab === 'action' && (
              <div className="p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={customAction}
                    onChange={e => {
                      setCustomAction(e.target.checked)
                      if (e.target.checked) {
                        setActionPerms((ACTION_DEFAULTS[form.role] ?? ACTION_DEFAULTS.editor) as Partial<Record<SectionKey, SectionPermission>>)
                      }
                    }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-xs text-gray-600 dark:text-slate-300">커스텀 설정 (미선택 시 역할 기본값 적용)</span>
                </label>
                {customAction && (() => {
                  const groups = [...new Set(SECTIONS.map(s => s.group))]
                  const toggleCell = (key: SectionKey, action: ActionKey) => {
                    setActionPerms(prev => {
                      const cur = prev[key] ?? (ACTION_DEFAULTS[form.role]?.[key] ?? { view: true, write: false, delete: false })
                      return { ...prev, [key]: { ...cur, [action]: !cur[action] } }
                    })
                  }
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-slate-600">
                            <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium w-32">섹션</th>
                            {(['view','write','delete'] as ActionKey[]).map(a => (
                              <th key={a} className="text-center py-2 px-2 text-gray-500 dark:text-slate-400 font-medium w-16">
                                {a === 'view' ? '조회' : a === 'write' ? '입력·수정' : '삭제'}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map(group => (
                            <>
                              <tr key={group} className="bg-gray-50 dark:bg-slate-700/40">
                                <td colSpan={4} className="px-3 py-1.5 text-[11px] text-gray-400 dark:text-slate-500 font-medium">{group}</td>
                              </tr>
                              {SECTIONS.filter(s => s.group === group).map(s => {
                                const perms = actionPerms[s.key] ?? ACTION_DEFAULTS[form.role]?.[s.key] ?? { view: true, write: false, delete: false }
                                return (
                                  <tr key={s.key} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50/50 dark:hover:bg-slate-700/20">
                                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{s.label}</td>
                                    {(['view','write','delete'] as ActionKey[]).map(a => {
                                      const disabled = s.disabled?.includes(a) ?? false
                                      const checked = !disabled && perms[a]
                                      return (
                                        <td key={a} className="text-center py-2 px-2">
                                          {disabled
                                            ? <span className="inline-block w-4 h-4 rounded bg-gray-100 dark:bg-slate-600 border border-gray-200 dark:border-slate-500" title="해당 없음" />
                                            : <input type="checkbox" checked={checked}
                                                onChange={() => toggleCell(s.key, a)}
                                                className="w-4 h-4 accent-blue-600 cursor-pointer" />
                                          }
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중…' : editId ? '수정 저장' : '사용자 추가'}
          </button>
        </form>
      )}

      {/* ── 법인 필터 칩 ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">법인 필터</span>
        {(['전체', ...companyNames] as string[]).map(c => (
          <button
            key={c}
            onClick={() => setFilterCompany(c)}
            className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filterCompany === c
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-600'
            }`}
          >
            {c}
            <span className={`text-[10px] ${filterCompany === c ? 'opacity-80' : 'opacity-60'}`}>
              {companyCounts[c] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* ── 검색 + 역할/상태 드롭다운 ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[180px] border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-700">
          <span className="text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="이름, 이메일, 코드 검색"
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-slate-100 placeholder-gray-400"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="text-gray-300 hover:text-gray-500 text-xs">✕</button>
          )}
        </div>
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-200"
        >
          <option value="전체">역할: 전체</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-200"
        >
          <option value="전체">상태: 전체</option>
          <option value="활성만">활성만</option>
          <option value="비활성만">비활성만</option>
        </select>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {filteredRows.length}명 {filteredRows.length !== rows.length && `/ 전체 ${rows.length}명`}
        </span>
      </div>

      {/* 사용자 목록 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border border-gray-100 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10 animate-pulse">로딩 중…</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">
            {rows.length === 0 ? '등록된 사용자가 없습니다.' : '조건에 맞는 사용자가 없습니다.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                  {['이름', '이메일', '코드', '역할', '법인', '권한', '상태', ''].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.id}
                    className={`border-b border-gray-50 dark:border-slate-700 hover:bg-gray-50/50 dark:hover:bg-slate-700/30 transition-colors ${!row.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
                      {row.name}
                      {row.id === user?.sb_id && <span className="ml-1.5 text-[10px] text-blue-500">(나)</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-300 text-xs">{row.email}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-gray-500">{row.user_code}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ROLE_BADGE[row.role]}`}>
                        {ROLES.find(r => r.value === row.role)?.label ?? row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-300">
                      {row.companies?.length
                        ? row.companies.map(c => shortName(c)).join('·')
                        : <span className="text-blue-400">전체</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {row.can_delete  && <span className="text-[10px] px-1.5 py-0.5 bg-red-50   dark:bg-red-900/20   text-red-500   rounded">삭제</span>}
                        {row.can_approve && <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded">결재</span>}
                        {row.menus !== null              && <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-purple-500 rounded">메뉴↑</span>}
                        {row.allowed_categories !== null && <span className="text-[10px] px-1.5 py-0.5 bg-green-50  dark:bg-green-900/20  text-green-600  rounded">카테고리↑</span>}
                        {row.action_permissions !== null && <span className="text-[10px] px-1.5 py-0.5 bg-sky-50    dark:bg-sky-900/20    text-sky-600    rounded">작업권한↑</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${row.is_active ? 'bg-green-50 text-green-600 dark:text-emerald-400' : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-gray-600'}`}>
                        {row.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(row)}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">수정</button>
                        <button onClick={() => void toggleActive(row)}
                          className="text-xs text-amber-500 hover:text-amber-700">
                          {row.is_active ? '비활성화' : '활성화'}
                        </button>
                        <button onClick={() => void handleDelete(row)}
                          className="text-xs text-red-400 hover:text-red-600">삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 안내 */}
      <div className="text-xs text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-1">
        <p className="font-semibold text-gray-500 dark:text-gray-500">📌 신규 사용자 등록 절차</p>
        <p>① 위 폼에서 이메일 + 권한 설정 후 저장</p>
        <p>② 사용자에게 <strong>로그인 URL + 이메일</strong> 안내</p>
        <p>③ 사용자가 "최초 계정 설정" 탭에서 비밀번호 직접 설정</p>
        <p>④ 이후 일반 로그인 사용</p>
        <p className="pt-1 text-gray-400 dark:text-gray-600">※ 사용자 삭제 시 Supabase Dashboard → Authentication에서 Auth 계정도 별도 삭제 필요</p>
      </div>
    </div>
  )
}

