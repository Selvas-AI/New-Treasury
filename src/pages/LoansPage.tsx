import { useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useToast } from '../contexts/ToastProvider'
import { useLoans } from '../hooks/useLoans'
import { useNegoLogs } from '../hooks/useNegoLogs'
import { useFx } from '../hooks/useFx'
import { toKRWAmount } from '../lib/treasuryCalc'
import { fmtKRW, calcDday } from '../lib/format'
import { NumInput } from '../components/common/NumInput'
import NegoLogPanel from '../components/common/NegoLogPanel'
import type { LoanRecord } from '../types'

const LOAN_TYPES    = ['일반대출', '한도대출', 'CP', '전자단기사채', '팩토링', '기타']
const CURRENCY_LIST = ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY']

const EMPTY_FORM = {
  lender:     '',
  type:       '일반대출',
  currency:   'KRW',
  amount:     '',
  rate:       '',
  start_date: new Date().toISOString().slice(0, 10),
  maturity:   '',
}
type FormState = typeof EMPTY_FORM

function DdayBadge({ dday }: { dday: number }) {
  const cls =
    dday < 0   ? 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-gray-500' :
    dday <= 7  ? 'bg-red-100 text-red-700 font-bold animate-pulse' :
    dday <= 30 ? 'bg-red-50 text-red-600 font-semibold' :
    dday <= 90 ? 'bg-amber-50 text-amber-700' :
                 'bg-gray-50 text-gray-500'
  const label = dday < 0 ? '만기경과' : `D-${dday}`
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

export default function LoansPage() {
  const { id: paramId } = useParams<{ id?: string }>()
  const auth = useAuth()
  const { canEdit, canAction } = auth
  const { company: currentCompany } = usePageCompany()
  const toast = useToast()
  const loans = useLoans(false, currentCompany)
  const nego  = useNegoLogs(currentCompany, 'loan')
  const fx    = useFx()

  useEffect(() => { void fx.fetchRates() }, [fx.fetchRates])

  const toKRWAmt = (amount: number, currency: string) => toKRWAmount(amount, currency, fx.toKRW)

  /** 외화는 "네이티브 금액" + "≈원화환산" 2줄 표시, KRW는 그대로 */
  function fmtAmtDisplay(amount: number, currency: string): { primary: string; sub: string | null } {
    if (!currency || currency === 'KRW') return { primary: fmtKRW(amount), sub: null }
    const native = amount >= 10000
      ? `${(amount / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만 ${currency}`
      : `${amount.toLocaleString('ko-KR')} ${currency}`
    const krw = toKRWAmt(amount, currency)
    const sub = krw > 0 ? `≈${fmtKRW(krw)}` : null
    return { primary: native, sub }
  }

  const [tab, setTab]         = useState<'active' | 'inactive'>('active')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]       = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId]   = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [negoId, setNegoId]   = useState<string | null>(null)

  // 딥링크 진입 시 수정 모드
  useEffect(() => {
    if (!paramId || !loans.data.length) return
    const rec = loans.data.find(r => r.id === paramId)
    if (rec) loadRecord(rec)
  }, [paramId, loans.data])

  const activeList   = useMemo(() => loans.data.filter(r =>  r.active), [loans.data])
  const inactiveList = useMemo(() => loans.data.filter(r => !r.active), [loans.data])
  const displayList  = tab === 'active' ? activeList : inactiveList

  // 집계 (외화는 KRW 환산 후 합산)
  const totalActive  = useMemo(() => activeList.reduce((s, r) => s + toKRWAmt(r.amount, r.currency), 0), [activeList, fx.toKRW])  // eslint-disable-line react-hooks/exhaustive-deps
  const d90Count     = useMemo(() => activeList.filter(r => calcDday(r.maturity) <= 90).length, [activeList])
  const d30Count     = useMemo(() => activeList.filter(r => calcDday(r.maturity) <= 30).length, [activeList])

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function loadRecord(rec: LoanRecord) {
    setEditId(rec.id)
    setForm({
      lender:     rec.lender,
      type:       rec.type,
      currency:   rec.currency,
      amount:     String(rec.amount    || ''),
      rate:       String(rec.rate      || ''),
      start_date: rec.start_date || '',
      maturity:   rec.maturity   || '',
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentCompany) return
    setSaving(true)
    setError(null)

    const record = {
      ...(editId ? { id: editId } : {}),
      company:    currentCompany,
      lender:     form.lender,
      type:       form.type,
      currency:   form.currency,
      amount:     Number(form.amount) || 0,
      rate:       Number(form.rate)   || 0,
      start_date: form.start_date,
      maturity:   form.maturity,
      active:     true,
    }

    const err = await loans.save(record)
    setSaving(false)
    if (err) { setError(err); toast.error(`차입금 저장 실패: ${err}`); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
    toast.success(editId ? '차입금이 수정되었습니다' : '차입금이 등록되었습니다')
    resetForm()
  }

  async function handleSetActive(id: string, active: boolean) {
    if (!confirm(active ? '차입금을 복원하시겠습니까?' : '상환 완료 처리하시겠습니까?')) return
    const err = await loans.setActive(id, active)
    if (err) toast.error(`처리 실패: ${err}`)
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return
    await loans.remove(id)
  }

  const isEditable = canEdit() && canAction('loans', 'write')

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">차입금</h2>
        {isEditable && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + 신규 등록
          </button>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 dark:bg-red-950/30 dark:border-red-800">
          <p className="text-xs text-red-600 font-medium mb-1 dark:text-red-400">차입금 합계</p>
          <p className="text-xl font-bold text-red-800 dark:text-red-300">{fmtKRW(totalActive)}</p>
          <p className="text-xs text-red-400 mt-1 dark:text-red-500">{activeList.length}건</p>
        </div>
        <div className={`border rounded-xl p-4 ${d30Count > 0 ? 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'}`}>
          <p className={`text-xs font-medium mb-1 ${d30Count > 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
            만기 D-90 이하
          </p>
          <p className={`text-xl font-bold ${d30Count > 0 ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
            {d90Count}건
          </p>
          {d30Count > 0 && (
            <p className="text-xs text-red-500 mt-1 dark:text-red-400">⚠️ D-30 이하 {d30Count}건</p>
          )}
        </div>
        <div className="col-span-2 md:col-span-1 bg-gray-50 border border-gray-200 rounded-xl p-4 dark:bg-slate-800 dark:border-slate-700">
          <p className="text-xs text-gray-500 font-medium mb-1 dark:text-slate-300">상환 완료</p>
          <p className="text-xl font-bold text-gray-600 dark:text-slate-100">{inactiveList.length}건</p>
        </div>
      </div>

      {/* 등록 폼 */}
      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 space-y-5 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {editId ? '✏️ 수정 중' : '+ 신규 등록'}
            </h3>
            <button type="button" onClick={resetForm}
              className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500">취소</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">금융기관 *</label>
              <input type="text" value={form.lender} onChange={e => setField('lender', e.target.value)}
                required placeholder="예: KB국민은행"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">차입유형 *</label>
              <select value={form.type} onChange={e => setField('type', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {LOAN_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">통화</label>
              <select value={form.currency} onChange={e => setField('currency', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {CURRENCY_LIST.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">차입금액 *</label>
              <NumInput value={form.amount} onChange={raw => setField('amount', raw)}
                required placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">금리 (%)</label>
              <input type="number" step="0.01" value={form.rate} onChange={e => setField('rate', e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">차입일</label>
              <input type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">만기일 *</label>
              <input type="date" value={form.maturity} onChange={e => setField('maturity', e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
          </div>

          {/* 만기 미리보기 */}
          {form.maturity && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-slate-300">만기까지:</span>
              <DdayBadge dday={calcDday(form.maturity)} />
            </div>
          )}

          {error   && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">✓ 저장되었습니다.</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '등록'}
          </button>
        </form>
      )}

      {/* 탭 + 목록 */}
      <div className="bg-white rounded-xl shadow dark:bg-slate-800">
        <div className="flex border-b border-gray-100 dark:border-slate-700">
          {[
            { key: 'active',   label: `차입 중 (${activeList.length})` },
            { key: 'inactive', label: `상환 완료 (${inactiveList.length})` },
          ].map(t => (
            <button key={t.key}
              onClick={() => setTab(t.key as 'active' | 'inactive')}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 dark:text-slate-300 dark:hover:text-gray-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {loans.loading ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">로딩 중...</p>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">데이터가 없습니다.</p>
          ) : (
            <>
              {/* 모바일 카드 리스트 */}
              <div className="md:hidden space-y-3">
                {displayList.map(rec => {
                  const dday = calcDday(rec.maturity)
                  const urgent = tab === 'active' && dday <= 7
                  const warn   = tab === 'active' && dday > 7 && dday <= 30
                  return (
                    <div key={rec.id} className={`rounded-xl border p-4 space-y-3 ${
                      urgent ? 'border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800' :
                      warn   ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800' :
                               'border-gray-200 bg-white dark:bg-slate-800 dark:border-slate-700'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">{rec.lender}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{rec.type} · {rec.currency}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {(() => { const { primary, sub } = fmtAmtDisplay(rec.amount, rec.currency); return (
                            <>
                              <p className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{primary}</p>
                              {sub && <p className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{sub}</p>}
                            </>
                          ) })()}
                          {tab === 'active' && <DdayBadge dday={dday} />}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="text-gray-400 dark:text-slate-400">금리</div>
                        <div className="text-gray-700 dark:text-slate-200">{rec.rate ? `${rec.rate}%` : '-'}</div>
                        <div className="text-gray-400 dark:text-slate-400">차입일</div>
                        <div className="text-gray-700 dark:text-slate-200">{rec.start_date}</div>
                        <div className="text-gray-400 dark:text-slate-400">만기일</div>
                        <div className="text-gray-700 dark:text-slate-200">{rec.maturity}</div>
                      </div>
                      <div className="flex gap-2 pt-1 border-t border-gray-100 dark:border-slate-700">
                        {isEditable && (
                          <>
                            <button onClick={() => loadRecord(rec)}
                              className="flex-1 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400">수정</button>
                            {tab === 'active'
                              ? <button onClick={() => handleSetActive(rec.id, false)}
                                  className="flex-1 py-1.5 text-xs rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400">상환처리</button>
                              : <button onClick={() => handleSetActive(rec.id, true)}
                                  className="flex-1 py-1.5 text-xs rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400">복원</button>
                            }
                            <button onClick={() => handleDelete(rec.id)}
                              className="flex-1 py-1.5 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400">삭제</button>
                          </>
                        )}
                        <button
                          onClick={() => setNegoId(id => id === rec.id ? null : rec.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            negoId === rec.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400'
                          }`}>
                          💬 {nego.byRecord.get(rec.id)?.length ?? 0}
                        </button>
                      </div>
                      {negoId === rec.id && (
                        <div className="mt-3 -mx-4 -mb-4 rounded-b-xl overflow-hidden">
                          <NegoLogPanel
                            logs={nego.byRecord.get(rec.id) ?? []}
                            company={currentCompany ?? ''}
                            recordType="loan"
                            recordId={rec.id}
                            contextLabel={`${rec.lender} · ${rec.type} · 만기 ${rec.maturity}`}
                            userLabel={auth.user?.label ?? ''}
                            canEdit={isEditable}
                            onAdd={nego.add}
                            onUpdate={nego.update}
                            onRemove={nego.remove}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
                {tab === 'active' && (
                  <div className="flex justify-between items-center px-1 pt-2 border-t border-gray-200 dark:border-slate-700">
                    <span className="text-xs text-gray-400 dark:text-gray-500">합계 {activeList.length}건</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{fmtKRW(totalActive)}</span>
                  </div>
                )}
              </div>
              {/* PC 테이블 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700">
                      {['금융기관', '유형', '통화', '차입금액', '금리', '차입일', '만기일', 'D-day', ''].map(h => (
                        <th key={h} className="text-left text-xs text-gray-400 font-medium pb-2 pr-3 whitespace-nowrap dark:text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.map(rec => {
                      const dday = calcDday(rec.maturity)
                      const rowBg =
                        tab === 'active' && dday <= 7  ? 'bg-red-50' :
                        tab === 'active' && dday <= 30 ? 'bg-amber-50/50' : ''
                      const negoLogs = nego.byRecord.get(rec.id) ?? []
                      const isOpen   = negoId === rec.id
                      return (
                        <Fragment key={rec.id}>
                          <tr className={`border-b border-gray-50 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700 ${rowBg} ${isOpen ? '!bg-blue-50/40 dark:!bg-slate-800/80' : ''}`}>
                            <td className="py-2.5 pr-3 font-medium text-gray-800 whitespace-nowrap dark:text-gray-100">{rec.lender}</td>
                            <td className="py-2.5 pr-3 text-gray-500 dark:text-slate-300">{rec.type}</td>
                            <td className="py-2.5 pr-3 text-gray-400 dark:text-gray-500">{rec.currency}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">
                              {(() => { const { primary, sub } = fmtAmtDisplay(rec.amount, rec.currency); return (
                                <>
                                  <div>{primary}</div>
                                  {sub && <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">{sub}</div>}
                                </>
                              ) })()}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-gray-600 dark:text-slate-100">{rec.rate ? `${rec.rate}%` : '-'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-400 whitespace-nowrap dark:text-gray-500">{rec.start_date}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap dark:text-slate-100">{rec.maturity}</td>
                            <td className="py-2.5 pr-3">
                              {tab === 'active' && <DdayBadge dday={dday} />}
                            </td>
                            <td className="py-2.5 whitespace-nowrap">
                              <div className="flex gap-1.5 items-center">
                                {/* 역방향 링크(D4): 차입금 → 이슈 스레드 */}
                                <Link to={`/issue-history/loan_${rec.id}`}
                                  title="이 차입금의 이슈 보기"
                                  className="text-xs text-gray-400 hover:text-blue-500">🔔 이슈</Link>
                                {isEditable && (
                                  <>
                                    <button onClick={() => loadRecord(rec)}
                                      className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                                    {tab === 'active'
                                      ? <button onClick={() => handleSetActive(rec.id, false)}
                                          className="text-xs text-emerald-500 hover:text-emerald-700">상환</button>
                                      : <button onClick={() => handleSetActive(rec.id, true)}
                                          className="text-xs text-amber-500 hover:text-amber-700">복원</button>
                                    }
                                    <button onClick={() => handleDelete(rec.id)}
                                      className="text-xs text-red-400 hover:text-red-600">삭제</button>
                                  </>
                                )}
                                <button
                                  onClick={() => setNegoId(id => id === rec.id ? null : rec.id)}
                                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                    isOpen
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : negoLogs.length > 0
                                        ? 'border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400'
                                        : 'border-gray-200 text-gray-400 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-500'
                                  }`}>
                                  💬{negoLogs.length > 0 ? ` ${negoLogs.length}` : ''}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={9} className="p-0">
                                <NegoLogPanel
                                  logs={negoLogs}
                                  company={currentCompany ?? ''}
                                  recordType="loan"
                                  recordId={rec.id}
                                  contextLabel={`${rec.lender} · ${rec.type} · 만기 ${rec.maturity}`}
                                  userLabel={auth.user?.label ?? ''}
                                  canEdit={isEditable}
                                  onAdd={nego.add}
                                  onUpdate={nego.update}
                                  onRemove={nego.remove}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  {tab === 'active' && (
                    <tfoot>
                      <tr className="border-t border-gray-200 dark:border-slate-700">
                        <td colSpan={3} className="pt-2.5 text-xs text-gray-400 dark:text-gray-500">합계</td>
                        <td className="pt-2.5 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">{fmtKRW(totalActive)}</td>
                        <td colSpan={5} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

