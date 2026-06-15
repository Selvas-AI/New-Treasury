/**
 * OrgChartPage — 조직도 / 결재선 관리
 *
 * 라우트: /admin/org-chart (master 전용)
 * 법인별 자금일보 결재선(approval config) 관리
 */
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useApprovalConfig } from '../../hooks/useDailyReport'
import { useCompanies } from '../../hooks/useCompanies'
import type { Company } from '../../types'

export default function OrgChartPage() {
  const { user } = useAuth()
  const { names: COMPANIES } = useCompanies()
  const [activeCompany, setActiveCompany] = useState<Company>(COMPANIES[0] ?? '셀바스에이아이')

  if (user?.role !== 'master') {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-600">
        관리자(master) 권한이 필요합니다.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-3 flex items-center gap-4 shrink-0">
        <span className="text-lg">🏢</span>
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">조직도 / 결재선 관리</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 ml-2">자금일보 결재선을 법인별로 설정합니다.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* 법인 탭 */}
        <div className="flex gap-1 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-1 w-fit">
          {COMPANIES.map(c => (
            <button
              key={c}
              onClick={() => setActiveCompany(c)}
              className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${
                activeCompany === c
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >{c}</button>
          ))}
        </div>

        <ApprovalConfigPanel company={activeCompany} />

        {/* 향후 확장 안내 */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-5 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-semibold mb-1">📌 조직도 시각화 예정</p>
          <p className="text-xs text-blue-500 dark:text-blue-400 leading-relaxed">
            향후 부서 계층 구조(팀 / 실 / 본부), 직책별 역할 배정,
            SSO 연동(Azure AD · Google Workspace) 계정 매핑 기능이 추가될 예정입니다.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── 결재선 패널 ────────────────────────────────────────────── */
function ApprovalConfigPanel({ company }: { company: Company }) {
  const ac = useApprovalConfig(company)

  const [form, setForm] = useState({ step: '', role_label: '', approver_code: '' })
  const [busy, setBusy] = useState(false)
  const [editTarget, setEditTarget] = useState<number | null>(null)

  async function handleSave() {
    const step = Number(form.step)
    if (!step || !form.role_label.trim() || !form.approver_code.trim()) return
    setBusy(true)
    await ac.upsert(step, form.role_label.trim(), form.approver_code.trim())
    setForm({ step: '', role_label: '', approver_code: '' })
    setEditTarget(null)
    setBusy(false)
  }

  async function handleRemove(step: number) {
    if (!confirm(`결재 ${step}단계를 삭제하시겠습니까?`)) return
    await ac.remove(step)
  }

  function startEdit(step: number, role_label: string, approver_code: string) {
    setEditTarget(step)
    setForm({ step: String(step), role_label, approver_code })
  }

  const sorted = [...ac.config].sort((a, b) => a.step - b.step)

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">결재선 설정</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">— {company}</span>
        {ac.loading && <span className="ml-auto text-xs text-gray-400 animate-pulse">로딩 중…</span>}
      </div>

      {/* 기존 결재선 목록 */}
      {sorted.length === 0 && !ac.loading ? (
        <p className="px-5 py-6 text-sm text-gray-400 dark:text-gray-600">설정된 결재선이 없습니다. 아래에서 추가하세요.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
              <th className="px-4 py-2.5 text-left font-medium text-gray-500 w-16">단계</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">직책</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">결재자 코드</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-500 w-24">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {sorted.map(cfg => (
              <tr key={cfg.step} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                <td className="px-4 py-3 font-semibold text-blue-600 dark:text-blue-400">{cfg.step}단계</td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{cfg.role_label}</td>
                <td className="px-4 py-3 font-mono text-gray-500 dark:text-slate-300">{cfg.approver_code}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => startEdit(cfg.step, cfg.role_label, cfg.approver_code)}
                    className="text-blue-500 hover:text-blue-700 dark:text-blue-400"
                  >수정</button>
                  <button
                    onClick={() => handleRemove(cfg.step)}
                    className="text-red-400 hover:text-red-600"
                  >삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 추가/수정 폼 */}
      <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-700/20">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-300 mb-3">
          {editTarget ? `${editTarget}단계 수정` : '새 결재단계 추가'}
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            type="number" min="1" max="9" placeholder="단계(1,2…)"
            value={form.step}
            disabled={!!editTarget}
            onChange={e => setForm(f => ({ ...f, step: e.target.value }))}
            className="w-24 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <input
            type="text" placeholder="직책 (예: 팀장)"
            value={form.role_label}
            onChange={e => setForm(f => ({ ...f, role_label: e.target.value }))}
            className="w-32 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            type="text" placeholder="결재자 접근코드"
            value={form.approver_code}
            onChange={e => setForm(f => ({ ...f, approver_code: e.target.value }))}
            className="w-40 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={handleSave}
            disabled={busy || !form.step || !form.role_label || !form.approver_code}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >{busy ? '저장 중…' : editTarget ? '수정 저장' : '추가'}</button>
          {editTarget && (
            <button
              onClick={() => { setEditTarget(null); setForm({ step: '', role_label: '', approver_code: '' }) }}
              className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >취소</button>
          )}
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2">
          결재자 코드: 해당 사용자의 접근코드 또는 이메일 주소를 입력하세요.
        </p>
      </div>
    </div>
  )
}

