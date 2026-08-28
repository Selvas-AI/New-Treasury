/**
 * CompaniesPage — 회사(법인) 관리 (master 전용)
 *
 * companies 테이블 CRUD. 추가/비활성화/삭제 후 invalidateCompanies()로
 * 전역 캐시를 갱신해 TopBar 드롭다운·사용자 관리 등 모든 소비처에 즉시 반영.
 *
 * ⚠ Supabase에 companies 테이블이 없으면 폴백(하드코딩 3법인)으로 표시되며
 *    추가/삭제는 실패 메시지를 반환한다 (docs/db/companies.sql 실행 필요).
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { restInsert, restUpdate, restDelete } from '../../lib/supabase'
import { useCompanies, invalidateCompanies, type CompanyRecord } from '../../hooks/useCompanies'
import MenuPermissionTree from '../../components/admin/MenuPermissionTree'
import { ASSIGNABLE_SLUGS } from '../../lib/navTree'

const inputCls =
  'w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400'

/**
 * 법인별 메뉴 구성 (2026-08-28)
 *
 * ⚠ 권한이 아니라 **표시 필터**다. 사용자 권한(treasury_users.menus)과 AND 로 결합된다.
 *   법인 자금 사정상 쓰지 않는 메뉴가 사이드바에 다 보여 정작 필요한 정보가 묻히던
 *   문제를 해결하기 위한 것이다(2026-08-28 요청).
 *
 * ⚠ 관리 섹션은 대상이 아니다 — 법인과 무관하고, 여기서 끄면 이 화면 자체에
 *   못 들어와 되돌릴 수 없다(navTree 의 masterOnly 섹션은 트리에서 체크 불가).
 */
function MenuConfigPanel({ rec, onClose }: { rec: CompanyRecord; onClose: () => void }) {
  const saved = Array.isArray(rec.menus) ? rec.menus : null
  const [enabled, setEnabled] = useState(saved !== null)
  const [menus, setMenus] = useState<string[]>(saved ?? [...ASSIGNABLE_SLUGS])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    try {
      // enabled=false → null 저장 = 전체 표시(기존 동작)
      const next = enabled ? menus.filter(m => ASSIGNABLE_SLUGS.includes(m)) : null
      const { error } = await restUpdate('companies', { menus: next }, { id: rec.id })
      if (error) {
        setErr(error.message.includes('menus')
          ? "companies.menus 컬럼이 없습니다 — docs/db/company_menus.sql 을 먼저 실행하세요."
          : error.message)
        return
      }
      await invalidateCompanies()
      setOk(true)
      setTimeout(() => setOk(false), 2500)
    } finally { setBusy(false) }
  }

  const hiddenCount = enabled ? ASSIGNABLE_SLUGS.filter(sl => !menus.includes(sl)).length : 0

  return (
    <div className="mt-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{rec.name} 메뉴 구성</span>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-600" />
          이 법인만 별도 구성
        </label>
        {!enabled && <span className="text-[11px] text-gray-400">해제 시 전체 메뉴가 표시됩니다(기본값).</span>}
        {enabled && hiddenCount > 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">{hiddenCount}개 메뉴 숨김</span>
        )}
        <button onClick={onClose} className="ml-auto text-xs text-gray-400 hover:text-gray-600">닫기</button>
      </div>

      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <MenuPermissionTree
          menusOnly
          selectedMenus={menus}
          roleDefaultMenus={ASSIGNABLE_SLUGS}
          menuEnabled={enabled}
          onMenuChange={setMenus}
          actions={{}} roleDefaultActions={{}} actionEnabled={false} onActionChange={() => {}}
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={busy}
          className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {busy ? '저장 중…' : '메뉴 구성 저장'}
        </button>
        {err && <p className="text-xs text-red-500">{err}</p>}
        {ok && <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 저장되었습니다. 해당 법인 선택 시 즉시 반영됩니다.</p>}
        <span className="ml-auto text-[11px] text-gray-400">
          사용자 권한과 함께 적용됩니다 — 둘 다 허용해야 보입니다.
        </span>
      </div>
    </div>
  )
}

export default function CompaniesPage() {
  const { user } = useAuth()
  const { companies } = useCompanies()
  const [form, setForm] = useState({ name: '', short_name: '', sort_order: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  // 법인별 메뉴 구성 편집 대상 (id) — null 이면 닫힘
  const [menuTarget, setMenuTarget] = useState<number | null>(null)

  if (user?.role !== 'master') return <Navigate to="/dashboard" replace />

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = form.name.trim()
    if (!name) { setError('법인명을 입력하세요.'); return }
    const shortN = form.short_name.trim() || null
    const order = parseInt(form.sort_order) || (companies.length + 1) * 10

    setSaving(true)
    try {
      // raw fetch 기반 — supabase-js 403 wedge 회피, 12s 타임아웃 내장
      const { error: err } = await restInsert('companies', {
        name, short_name: shortN, sort_order: order, active: true,
      })
      if (err) {
        if (err.message.includes('duplicate') || err.message.includes('unique')) {
          setError('이미 등록된 법인명입니다.')
        } else if (err.message.includes('does not exist') || err.status === 404) {
          setError('companies 테이블이 없습니다. docs/db/companies.sql 을 먼저 실행하세요.')
        } else if (err.message.includes('permission denied') || err.status === 401 || err.status === 403) {
          setError('권한 오류(RLS). 최신 docs/db/companies.sql 의 정책을 다시 실행하세요.')
        } else {
          setError(err.message)
        }
        return
      }
      await invalidateCompanies()
      setForm({ name: '', short_name: '', sort_order: '' })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rec: CompanyRecord) {
    setBusyId(rec.id)
    try {
      const { error: err } = await restUpdate('companies', { active: !rec.active }, { id: rec.id })
      if (err) { alert(`상태 변경 실패: ${err.message}`); return }
      await invalidateCompanies()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(rec: CompanyRecord) {
    if (!confirm(
      `"${rec.name}" 법인을 삭제하시겠습니까?\n\n` +
      `※ 이미 입력된 데이터(운전자금·운용자금 등)는 삭제되지 않지만,\n` +
      `   해당 법인 선택지가 사라져 조회가 어려워집니다.\n` +
      `   더 이상 사용하지 않는 법인은 "비활성화"를 권장합니다.`,
    )) return
    setBusyId(rec.id)
    try {
      const { error: err } = await restDelete('companies', { id: rec.id })
      if (err) { alert(`삭제 실패: ${err.message}`); return }
      await invalidateCompanies()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">회사 관리</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          법인을 추가/비활성화/삭제합니다. 변경 사항은 법인 선택·사용자 권한·자금일보 등 전체 화면에 즉시 반영됩니다.
        </p>
      </div>

      {/* 등록된 법인 목록 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow border border-gray-100 dark:border-slate-700 p-5">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-300 mb-3">
          등록된 법인 <span className="text-gray-400">({companies.filter(c => c.active).length}개 활성)</span>
        </p>
        <div className="space-y-2">
          {companies.map(rec => (
            <div key={rec.id}
              className={`px-3 py-2.5 rounded-lg border ${rec.active ? 'border-gray-200 dark:border-slate-600' : 'border-gray-100 dark:border-slate-700 opacity-50'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${rec.active ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{rec.name}</span>
                {rec.short_name && (
                  <span className="text-xs bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">
                    {rec.short_name}
                  </span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">순서 {rec.sort_order}</span>
                {!rec.active && <span className="text-[10px] text-gray-400">비활성</span>}
                {Array.isArray(rec.menus) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                    title="이 법인은 별도 메뉴 구성이 적용됩니다">
                    메뉴 {rec.menus.length}/{ASSIGNABLE_SLUGS.length}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setMenuTarget(menuTarget === rec.id ? null : rec.id)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 transition-colors"
                >
                  메뉴 구성
                </button>
                <button
                  onClick={() => void toggleActive(rec)}
                  disabled={busyId === rec.id}
                  className="text-xs text-amber-500 hover:text-amber-700 dark:text-amber-400 disabled:opacity-40 transition-colors"
                >
                  {rec.active ? '비활성화' : '활성화'}
                </button>
                <button
                  onClick={() => void handleDelete(rec)}
                  disabled={busyId === rec.id}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
            {menuTarget === rec.id && (
              <MenuConfigPanel rec={rec} onClose={() => setMenuTarget(null)} />
            )}
            </div>
          ))}
        </div>
      </div>

      {/* 신규 법인 추가 */}
      <form onSubmit={e => void handleAdd(e)}
        className="bg-white dark:bg-slate-800 rounded-xl shadow border border-gray-100 dark:border-slate-700 p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">+ 새 법인 추가</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">법인명 <span className="text-red-400">*</span></label>
            <input type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="예: 셀바스메디컬" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">약칭</label>
            <input type="text" value={form.short_name}
              onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))}
              placeholder="예: MED2" maxLength={6} className={inputCls + ' font-mono'} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">정렬순서</label>
            <input type="number" value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              placeholder="40" className={inputCls} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {saving ? '추가 중…' : '+ 법인 추가'}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
          {success && <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 법인이 추가되었습니다.</p>}
        </div>
      </form>

      {/* 안내 */}
      <div className="text-xs text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-1">
        <p className="font-semibold text-gray-500 dark:text-gray-500">📌 안내</p>
        <p>① 법인 추가 전 Supabase SQL Editor에서 <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">docs/db/companies.sql</code> 실행 필요</p>
        <p>② 추가된 법인은 마스터·관리자에게 즉시 보이며, 편집자·뷰어는 사용자 관리에서 접근 허용 법인으로 지정해야 보입니다.</p>
        <p>③ 신규 법인은 데이터가 비어 있는 상태로 시작되며, 운전자금·운용자금·자금일보 등 모든 기능을 동일하게 사용할 수 있습니다.</p>
        <p>④ 사용을 중단할 법인은 삭제보다 <strong>비활성화</strong>를 권장합니다 (기존 데이터 보존).</p>
        <p>⑤ <strong>메뉴 구성</strong>은 권한이 아니라 표시 필터입니다 — 법인에서 쓰지 않는 메뉴를 숨겨 노이즈를 줄입니다.
           사용자 권한과 <strong>둘 다 허용</strong>해야 사이드바에 보입니다. 관리 메뉴는 법인과 무관해 대상이 아닙니다.
           사용하려면 <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">docs/db/company_menus.sql</code> 실행이 필요합니다.</p>
      </div>
    </div>
  )
}

