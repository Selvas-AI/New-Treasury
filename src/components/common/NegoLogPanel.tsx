import { useState } from 'react'
import type { NegoLog, NegoLogDraft } from '../../hooks/useNegoLogs'

const NEGO_TYPES: NegoLog['nego_type'][] = ['비딩', '금리네고', '재예치협의', '상환협의', '기타']
const OUTCOMES:   NegoLog['outcome'][]   = ['진행중', '채택', '미채택', '보류']

function outcomeBadge(o: NegoLog['outcome']) {
  const m = {
    '진행중': 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
    '채택':   'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    '미채택': 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
    '보류':   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  }
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m[o]}`}>{o}</span>
}

function typeBadge(t: NegoLog['nego_type']) {
  const m = {
    '비딩':     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    '금리네고':  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    '재예치협의':'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    '상환협의':  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    '기타':     'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300',
  }
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${m[t]}`}>{t}</span>
}

const DOT_COLORS = ['bg-blue-500','bg-teal-500','bg-amber-500','bg-purple-500','bg-pink-500','bg-emerald-500']

interface Props {
  logs:         NegoLog[]
  company:      string
  recordType:   'investment' | 'loan'
  recordId:     string
  contextLabel: string   // "기업은행 · 정기예금 · 만기 2026-08-15"
  userLabel:    string
  canEdit:      boolean
  onAdd:    (draft: NegoLogDraft) => Promise<string | null>
  onUpdate: (id: string, patch: Partial<NegoLogDraft>) => Promise<string | null>
  onRemove: (id: string) => Promise<string | null>
}

const EMPTY_FORM = {
  nego_date:      new Date().toISOString().slice(0, 10),
  nego_type:      '비딩' as NegoLog['nego_type'],
  institution:    '',
  offered_rate:   '',
  contact_person: '',
  outcome:        '진행중' as NegoLog['outcome'],
  notes:          '',
}

export default function NegoLogPanel({
  logs, company, recordType, recordId, contextLabel, userLabel, canEdit,
  onAdd, onUpdate, onRemove,
}: Props) {
  const [showForm, setShowForm]   = useState(false)
  const [editId,   setEditId]     = useState<string | null>(null)
  const [form,     setForm]       = useState({ ...EMPTY_FORM })
  const [saving,   setSaving]     = useState(false)
  const [err,      setErr]        = useState<string | null>(null)
  const [showBid,  setShowBid]    = useState(false)

  function setF<K extends keyof typeof EMPTY_FORM>(k: K, v: typeof EMPTY_FORM[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, nego_date: new Date().toISOString().slice(0, 10) })
    setErr(null)
    setShowForm(true)
  }

  function openEdit(log: NegoLog) {
    setEditId(log.id)
    setForm({
      nego_date:      log.nego_date,
      nego_type:      log.nego_type,
      institution:    log.institution,
      offered_rate:   log.offered_rate != null ? String(log.offered_rate) : '',
      contact_person: log.contact_person ?? '',
      outcome:        log.outcome,
      notes:          log.notes ?? '',
    })
    setErr(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    const draft: NegoLogDraft = {
      company,
      record_type:    recordType,
      record_id:      recordId,
      nego_date:      form.nego_date,
      nego_type:      form.nego_type,
      institution:    form.institution.trim(),
      offered_rate:   form.offered_rate !== '' ? Number(form.offered_rate) : null,
      contact_person: form.contact_person.trim() || null,
      outcome:        form.outcome,
      notes:          form.notes.trim() || null,
      user_label:     userLabel,
    }
    const error = editId
      ? await onUpdate(editId, draft)
      : await onAdd(draft)
    setSaving(false)
    if (error) { setErr(error); return }
    setShowForm(false)
    setEditId(null)
  }

  async function handleRemove(id: string) {
    if (!confirm('이 이력을 삭제하시겠습니까?')) return
    await onRemove(id)
  }

  // 비딩 비교: 동일 건에서 여러 기관에 제시금리가 있는 경우
  const bidRows = logs
    .filter(l => l.offered_rate != null)
    .sort((a, b) => (b.offered_rate ?? 0) - (a.offered_rate ?? 0))
  const hasBid = bidRows.length >= 2

  // 기관별 점 색상 매핑
  const instColorMap = new Map<string, string>()
  let colorIdx = 0
  for (const log of logs) {
    if (!instColorMap.has(log.institution)) {
      instColorMap.set(log.institution, DOT_COLORS[colorIdx % DOT_COLORS.length])
      colorIdx++
    }
  }

  return (
    <div className="bg-blue-50/50 dark:bg-slate-900/60 border-t border-blue-100 dark:border-slate-700 px-4 py-3">

      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">💬 금리 네고 · 비딩 이력</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{contextLabel}</span>
        <div className="flex gap-2 ml-auto shrink-0">
          {hasBid && (
            <button
              onClick={() => setShowBid(v => !v)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                showBid
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400'
              }`}
            >
              📊 비딩 비교
            </button>
          )}
          {canEdit && !showForm && (
            <button
              onClick={openAdd}
              className="text-xs px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 transition-colors"
            >
              + 추가
            </button>
          )}
        </div>
      </div>

      {/* 비딩 비교 카드 */}
      {showBid && hasBid && (
        <div className="mb-3 bg-white dark:bg-slate-800 rounded-xl border border-blue-100 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-700 text-xs font-medium text-gray-600 dark:text-slate-300">
            금리 비교 ({bidRows.length}개 기관)
          </div>
          {bidRows.map((log, i) => {
            const isTop = i === 0
            return (
              <div key={log.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${isTop ? 'bg-green-50 dark:bg-green-950/30' : ''}`}>
                <span className="text-xs text-gray-400 dark:text-gray-500 w-4 tabular-nums">{i + 1}</span>
                <span className={`flex-1 font-medium ${isTop ? 'text-green-800 dark:text-green-300' : 'text-gray-700 dark:text-gray-200'}`}>
                  {log.institution}
                </span>
                <span className={`tabular-nums font-semibold ${isTop ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-300'}`}>
                  {log.offered_rate}%
                </span>
                {isTop && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">최고</span>}
                {outcomeBadge(log.outcome)}
              </div>
            )
          })}
          {bidRows.length >= 2 && (
            <div className="px-4 py-1.5 border-t border-gray-100 dark:border-slate-700 text-xs text-gray-400 dark:text-gray-500">
              스프레드 {((bidRows[0].offered_rate ?? 0) - (bidRows[bidRows.length - 1].offered_rate ?? 0)).toFixed(2)}%p
            </div>
          )}
        </div>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-3 bg-white dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-blue-700 p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {editId ? '✏️ 이력 수정' : '+ 새 이력 추가'}
            </span>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-sm leading-none">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">날짜 *</label>
              <input type="date" value={form.nego_date} onChange={e => setF('nego_date', e.target.value)}
                required
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">유형 *</label>
              <select value={form.nego_type} onChange={e => setF('nego_type', e.target.value as NegoLog['nego_type'])}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {NEGO_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">금융기관 *</label>
              <input type="text" value={form.institution} onChange={e => setF('institution', e.target.value)}
                required placeholder="국민은행"
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">제시금리 (%)</label>
              <input type="number" step="0.001" min="0" max="100"
                value={form.offered_rate} onChange={e => setF('offered_rate', e.target.value)}
                placeholder="3.650"
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">담당자</label>
              <input type="text" value={form.contact_person} onChange={e => setF('contact_person', e.target.value)}
                placeholder="박○○ 팀장"
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">결과</label>
              <select value={form.outcome} onChange={e => setF('outcome', e.target.value as NegoLog['outcome'])}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {OUTCOMES.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">메모</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)}
              rows={2} placeholder="협의 내용, 조건, 특이사항 등"
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm resize-none dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? '저장 중...' : editId ? '수정 저장' : '저장'}
            </button>
          </div>
        </form>
      )}

      {/* 이력 타임라인 */}
      {logs.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
          아직 기록된 이력이 없습니다.
          {canEdit && !showForm && (
            <button onClick={openAdd} className="ml-2 text-blue-500 hover:underline">+ 첫 이력 추가</button>
          )}
        </p>
      ) : (
        <div className="space-y-0">
          {logs.map(log => {
            const dotColor = instColorMap.get(log.institution) ?? DOT_COLORS[0]
            return (
              <div key={log.id} className="flex gap-3 py-2.5 border-b border-blue-100/60 dark:border-slate-700/60 last:border-0">
                <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{log.institution}</span>
                    {typeBadge(log.nego_type)}
                    {outcomeBadge(log.outcome)}
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto shrink-0">{log.nego_date}</span>
                  </div>
                  <div className="flex gap-4 mt-0.5 text-xs">
                    {log.offered_rate != null && (
                      <span className="text-gray-700 dark:text-gray-200">
                        제시금리 <strong className="tabular-nums">{log.offered_rate}%</strong>
                      </span>
                    )}
                    {log.contact_person && (
                      <span className="text-gray-400 dark:text-gray-500">담당 {log.contact_person}</span>
                    )}
                    {log.user_label && (
                      <span className="text-gray-400 dark:text-gray-500">기록 {log.user_label}</span>
                    )}
                  </div>
                  {log.notes && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{log.notes}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-1.5 shrink-0 items-start pt-0.5">
                    <button onClick={() => openEdit(log)}
                      className="text-[11px] text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300">수정</button>
                    <button onClick={() => handleRemove(log.id)}
                      className="text-[11px] text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">삭제</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
