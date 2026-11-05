/**
 * OrgChartPage — 조직도 / 결재선 관리
 *
 * 라우트: /admin/org-chart (master 전용)
 * 법인별 자금일보 결재선(approval config) 관리
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useApprovalConfig, type ApprovalConfig } from '../../hooks/useDailyReport'
import { useCompanies } from '../../hooks/useCompanies'
import { supabase } from '../../lib/supabase'
import UserPicker from '../../components/common/UserPicker'
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

        <ApprovalConfigPanel key={activeCompany} company={activeCompany} />

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

  const [form, setForm] = useState({ step: '', stage: '', role_label: '', approver_code: '' })
  const [busy, setBusy] = useState(false)
  const [editTarget, setEditTarget] = useState<number | null>(null)
  // 기존 단계를 덮어쓰겠다는 명시적 확인 — 체크하기 전에는 저장되지 않는다
  const [overwrite, setOverwrite] = useState(false)
  const [nameByCode, setNameByCode] = useState<Record<string, string>>({})
  // 결재선에 넣어도 계정의 can_approve 가 false 면 승인 버튼이 아예 안 나온다.
  // 두 값이 별개 필드라 관리자가 그 사실을 알 방법이 없었다(2026-08-27 실사고).
  const [canApproveByCode, setCanApproveByCode] = useState<Record<string, boolean>>({})

  // 결재자 코드 → 이름/결재권한 매핑 (테이블 표시용)
  useEffect(() => {
    supabase
      .from('treasury_users')
      .select('user_code, name, can_approve, role')
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string> = {}
        const ap: Record<string, boolean> = {}
        for (const u of data as { user_code: string; name: string; can_approve: boolean; role: string }[]) {
          map[u.user_code] = u.name
          // master 는 canApprove 게이트를 무조건 통과한다(DailyReportPage 와 동일 규칙)
          ap[u.user_code] = u.role === 'master' || u.can_approve !== false
        }
        setNameByCode(map)
        setCanApproveByCode(ap)
      })
  }, [])

  async function handleSave() {
    // 단계 미입력 = 새 슬롯 자동 배정. 기존 결재자를 건드리지 않는 안전한 기본값이다.
    const step = typedStep ?? nextFreeStep
    if (!step || isNaN(step) || !form.role_label.trim() || !form.approver_code.trim()) return
    if (collision && !overwrite) return   // 교체는 반드시 명시적으로
    setBusy(true)
    // 차수 미입력 = step 과 동일 = 순차 결재(기존 동작). null 로 넘긴다.
    const stage = form.stage.trim() ? Number(form.stage) : null
    await ac.upsert(step, form.role_label.trim(), form.approver_code.trim(),
      stage && !isNaN(stage) ? stage : null)
    setForm({ step: '', stage: '', role_label: '', approver_code: '' })
    setEditTarget(null)
    setOverwrite(false)
    setBusy(false)
  }

  async function handleRemove(step: number) {
    if (!confirm(`결재 ${step}단계를 삭제하시겠습니까?`)) return
    await ac.remove(step)
  }

  function startEdit(cfg: ApprovalConfig) {
    setEditTarget(cfg.step)
    setOverwrite(false)
    setForm({
      step: String(cfg.step),
      stage: cfg.stage != null ? String(cfg.stage) : '',
      role_label: cfg.role_label,
      approver_code: cfg.approver_code,
    })
  }

  // ⚠ 정렬은 **차수 우선**이다. No.(슬롯 번호)는 자동 배정된 식별자일 뿐이라
  //   그 순으로 늘어놓으면 실제 결재 흐름과 순서가 어긋나 보인다
  //   (예: No.4 가 1차인데 No.2(2차) 아래에 표시됨).
  const sorted = [...ac.config].sort(
    (a, b) => ((a.stage ?? a.step) - (b.stage ?? b.step)) || (a.step - b.step),
  )

  // ⚠ step 은 '결재자 슬롯 고유번호'이고 (법인, step) 이 유니크다.
  //   기존 step 을 다시 입력하면 upsert 가 그 행을 지우고 새로 넣는다 = 사람이 교체된다.
  //   같은 차수에 **추가**하려면 비어 있는 step 이어야 한다 — 실사용에서 이걸 모른 채
  //   2단계를 다시 입력해 기존 결재자가 조용히 사라졌다(2026-11-05 리포트).
  //   → 비워두면 자동 배정하고, 겹치면 저장을 막고 덮어쓰기를 명시적으로 받는다.
  const usedSteps = new Set(ac.config.map(c => c.step))
  const nextFreeStep = (() => { let n = 1; while (usedSteps.has(n)) n++; return n })()
  const typedStep = form.step.trim() ? Number(form.step) : null
  const collision = !editTarget && typedStep != null && usedSteps.has(typedStep)
    ? (ac.config.find(c => c.step === typedStep) ?? null)
    : null

  // 차수가 같은 슬롯이 둘 이상이면 병렬 — 화면에 그 사실을 분명히 적는다.
  const stageCount = new Map<number, number>()
  for (const c of sorted) {
    const g = c.stage ?? c.step
    stageCount.set(g, (stageCount.get(g) ?? 0) + 1)
  }

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
        <>
        {sorted.some(c => canApproveByCode[c.approver_code] === false) && (
          <p className="mx-5 mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
            ⚠ 결재선에 등록됐지만 <b>결재 권한(can_approve)이 없는 결재자</b>가 있습니다 — 해당 단계에서 승인·반려 버튼이
            표시되지 않아 결재가 진행되지 않습니다. 사용자 관리에서 결재 권한을 부여하세요.
          </p>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
              <th
                className="px-4 py-2.5 text-left font-medium text-gray-500 w-28"
                title="결재 진행 순서입니다. 같은 차수끼리 동시(병렬) 결재하고, 차수가 다르면 앞 차수가 전원 승인된 뒤에 다음 차수 차례가 됩니다. 목록은 이 순서로 정렬됩니다."
              >차수 ↓</th>
              <th
                className="px-4 py-2.5 text-left font-medium text-gray-400 w-14"
                title="결재자 슬롯 식별번호입니다. 결재 순서와는 무관하며, 추가할 때 자동 배정됩니다."
              >No.</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">이름</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">직책</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-500">결재자 코드</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-500 w-24">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {sorted.map((cfg, i) => {
              const myStage = cfg.stage ?? cfg.step
              const prev = i > 0 ? sorted[i - 1] : null
              // 같은 차수의 첫 행에만 차수를 적는다 — 아래 행들이 '같은 묶음'임이 눈에 보인다
              const firstOfStage = !prev || (prev.stage ?? prev.step) !== myStage
              return (
              <tr key={cfg.step} className={`hover:bg-gray-50 dark:hover:bg-slate-700/30 ${
                firstOfStage && i > 0 ? 'border-t-2 border-gray-200 dark:border-slate-600' : ''
              }`}>
                <td className="px-4 py-3 whitespace-nowrap align-top">
                  {firstOfStage ? (
                    <>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">{myStage}차</span>
                      {(stageCount.get(myStage) ?? 0) > 1 && (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                          병렬 {stageCount.get(myStage)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-300 dark:text-slate-600" title={`${myStage}차 (위와 동시 결재)`}>↳ 동시</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-slate-500 tabular-nums">{cfg.step}</td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                  {nameByCode[cfg.approver_code] ?? '—'}
                  {canApproveByCode[cfg.approver_code] === false && (
                    <span
                      title="이 계정은 결재 권한(can_approve)이 꺼져 있어 자금일보에 승인·반려 버튼이 표시되지 않습니다. 사용자 관리에서 결재 권한을 부여하세요."
                      className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 whitespace-nowrap"
                    >⚠ 결재 권한 없음</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{cfg.role_label}</td>
                <td className="px-4 py-3 font-mono text-gray-500 dark:text-slate-300">{cfg.approver_code}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => startEdit(cfg)}
                    className="text-blue-500 hover:text-blue-700 dark:text-blue-400"
                  >수정</button>
                  <button
                    onClick={() => handleRemove(cfg.step)}
                    className="text-red-400 hover:text-red-600"
                  >삭제</button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </>
      )}

      {/* 추가/수정 폼 */}
      <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-700/20">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-300 mb-3">
          {editTarget ? `No. ${editTarget} 수정` : '결재자 추가'}
        </p>
        {ac.error && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-2 px-1">⚠ {ac.error}</p>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            type="number" min="1" max="9"
            placeholder="차수(1,2…)"
            title="결재 진행 순서입니다. 같은 차수를 가진 결재자들은 동시에 결재합니다. 비우면 No. 와 같아져 순차가 됩니다."
            value={form.stage}
            onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
            className="w-24 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <input
            type="number" min="1" max="9"
            placeholder={editTarget ? 'No.' : `No. 자동(${nextFreeStep})`}
            title="결재자 슬롯 식별번호입니다. 결재 순서와 무관하며, 비워두면 빈 번호가 자동 배정됩니다. 기존 번호를 넣으면 그 결재자가 교체됩니다."
            value={form.step}
            disabled={!!editTarget}
            onChange={e => { setForm(f => ({ ...f, step: e.target.value })); setOverwrite(false) }}
            className="w-28 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-400 dark:text-slate-400 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <input
            type="text" placeholder="직책 (예: 팀장)"
            value={form.role_label}
            onChange={e => setForm(f => ({ ...f, role_label: e.target.value }))}
            className="w-32 text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <UserPicker
            company={company}
            value={form.approver_code}
            onChange={(code, label) => setForm(f => ({
              ...f,
              approver_code: code,
              role_label: f.role_label || label,
            }))}
            className="flex-1 min-w-[160px]"
          />
          <button
            onClick={handleSave}
            disabled={busy || !form.role_label || !form.approver_code || (!!collision && !overwrite)}
            className={`text-xs px-3 py-1.5 text-white rounded-lg disabled:opacity-40 transition-colors ${
              collision ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >{busy ? '저장 중…' : editTarget ? '수정 저장' : collision ? '교체 저장' : '추가'}</button>
          {editTarget && (
            <button
              onClick={() => { setEditTarget(null); setOverwrite(false); setForm({ step: '', stage: '', role_label: '', approver_code: '' }) }}
              className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >취소</button>
          )}
        </div>
        {collision && (
          <div className="mt-3 rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-300">
            <div className="font-medium">
              ⚠ No. {collision.step} 은 이미 <b>{nameByCode[collision.approver_code] ?? collision.approver_code}</b>
              ({collision.role_label} · {collision.stage ?? collision.step}차)가 사용 중입니다.
            </div>
            <div className="mt-1 text-red-600 dark:text-red-400 leading-relaxed">
              같은 차수에 <b>나란히 추가</b>하시려면 No. 를 비우고(자동 {nextFreeStep})
              차수만 <b>{form.stage.trim() || (collision.stage ?? collision.step)}</b>로 지정하세요.
              이대로 저장하면 기존 결재자가 <b>교체</b>됩니다.
            </div>
            <label className="mt-2 flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              <span>알고 있습니다 — {nameByCode[collision.approver_code] ?? collision.approver_code}를 교체합니다</span>
            </label>
            <button
              onClick={() => { setForm(f => ({ ...f, step: '' })); setOverwrite(false) }}
              className="mt-2 text-[11px] underline underline-offset-2 hover:text-red-900 dark:hover:text-red-200"
            >→ 새 슬롯(No. {nextFreeStep})으로 추가하기</button>
          </div>
        )}
        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2 leading-relaxed">
          {company} 소속 활성 사용자 목록에서 선택하세요. 이름·코드·이메일로 검색 가능합니다.
          <br />
          <strong className="text-gray-500 dark:text-gray-500">차수</strong>가 결재 순서입니다 — 중간결재자 여러 명에게 같은 차수(예: 모두 1)를 주면
          <strong className="text-gray-500 dark:text-gray-500"> 동시에</strong> 결재할 수 있고, 최종결재자에게 더 큰 차수(예: 2)를 주면
          그들이 모두 승인한 뒤에 차례가 옵니다. 비우면 No. 와 같아져 <strong className="text-gray-500 dark:text-gray-500">순차 결재</strong>입니다.
          <br />
          <strong className="text-gray-500 dark:text-gray-500">No.</strong> 는 결재자 슬롯 식별번호로 순서와 무관합니다 — 비워두면 자동 배정되므로 보통 건드릴 필요가 없습니다.
        </p>
      </div>
    </div>
  )
}

