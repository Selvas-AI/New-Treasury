import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useInvestments } from '../hooks/useInvestments'
import { usePolicyBankLimits } from '../hooks/usePolicyBankLimits'
import { fmtKRW, calcDday, fmtReturn, returnBadgeClass, calcReturn } from '../lib/format'
import { NumInput } from '../components/common/NumInput'
import { getCompanyNames } from '../hooks/useCompanies'
import type { InvestmentRecord, Company } from '../types'

const PRODUCT_OPTIONS = ['정기예금', 'RP', 'MMF', '발행어음', 'CMA', '채권', '기타']
const CURRENCY_OPTIONS = ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY']

const EMPTY_FORM = {
  bank: '',
  product: '정기예금',
  currency: 'KRW',
  amount: '',
  available: '가용' as '가용' | '불가용',
  rate: '',
  start: new Date().toISOString().slice(0, 10),
  maturity: '',
  acquisition_cost: '',
}

type FormState = typeof EMPTY_FORM

export default function InvestPage() {
  const { company: paramCompany, id: paramId } = useParams<{ company?: string; id?: string }>()
  const { user, currentCompany, setCurrentCompany, canEdit, canAction } = useAuth()
  const invest = useInvestments()
  const bankMaster = usePolicyBankLimits(currentCompany)

  const [tab, setTab]           = useState<'active' | 'inactive'>('active')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId]     = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  useEffect(() => {
    if (!paramCompany || user?.role === 'company') return
    if (getCompanyNames().includes(paramCompany)) setCurrentCompany(paramCompany as Company)
  }, [paramCompany, user?.role, setCurrentCompany])

  useEffect(() => {
    if (!paramId || !invest.nonBonds.length) return
    const rec = invest.nonBonds.find(r => r.id === paramId)
    if (rec) loadRecord(rec)
  }, [paramId, invest.nonBonds])

  const activeList   = useMemo(() => invest.nonBonds.filter(r => r.active),  [invest.nonBonds])
  const inactiveList = useMemo(() => invest.nonBonds.filter(r => !r.active), [invest.nonBonds])
  const displayList  = tab === 'active' ? activeList : inactiveList

  const totalAvail   = useMemo(() => activeList.filter(r => r.available === '가용')  .reduce((s, r) => s + r.amount, 0), [activeList])
  const totalUnavail = useMemo(() => activeList.filter(r => r.available === '불가용').reduce((s, r) => s + r.amount, 0), [activeList])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function loadRecord(rec: InvestmentRecord) {
    setEditId(rec.id)
    setForm({
      bank:             rec.bank,
      product:          rec.product,
      currency:         rec.currency,
      amount:           String(rec.amount || ''),
      available:        rec.available,
      rate:             String(rec.rate || ''),
      start:            rec.start || '',
      maturity:         rec.maturity || '',
      acquisition_cost: String(rec.acquisition_cost || ''),
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
      company:          currentCompany,
      bank:             form.bank,
      product:          form.product,
      currency:         form.currency,
      amount:           Number(form.amount) || 0,
      available:        form.available,
      rate:             Number(form.rate)   || 0,
      start:            form.start,
      maturity:         form.maturity,
      active:           true,
      acquisition_cost: Number(form.acquisition_cost) || 0,
    }
    const err = await invest.save(record)
    setSaving(false)
    if (err) { setError(err); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
    resetForm()
  }

  async function handleSetActive(id: string, active: boolean) {
    if (!confirm(active ? '복원하시겠습니까?' : '만기 처리하시겠습니까?')) return
    await invest.setActive(id, active)
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return
    await invest.remove(id)
  }

  const isEditable = canEdit() && canAction('invest', 'write')

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">운용자금</h2>
        {isEditable && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + 신규 등록
          </button>
        )}
      </div>

      {/* KPI 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 dark:bg-blue-950/30 dark:border-blue-800">
          <p className="text-xs text-blue-600 font-medium mb-1 dark:text-blue-400">가용 합계</p>
          <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{fmtKRW(totalAvail)}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 dark:bg-slate-800 dark:border-slate-700">
          <p className="text-xs text-gray-500 font-medium mb-1 dark:text-slate-300">불가용 합계</p>
          <p className="text-xl font-bold text-gray-700 dark:text-gray-200">{fmtKRW(totalUnavail)}</p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-emerald-50 border border-emerald-200 rounded-xl p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
          <p className="text-xs text-emerald-600 font-medium mb-1 dark:text-emerald-400">총 운용 합계</p>
          <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300">{fmtKRW(totalAvail + totalUnavail)}</p>
        </div>
      </div>

      {/* 입력 폼 */}
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
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">
                금융기관 *
                {bankMaster.data.length > 0 && (
                  <span className="ml-1 text-gray-400 font-normal">({bankMaster.data.length}개 등록)</span>
                )}
              </label>
              {/* datalist: 자금정책 → 기관한도에 등록된 기관 목록 자동완성 */}
              <datalist id="bank-master-list">
                {bankMaster.data.map(b => (
                  <option key={b.id} value={b.bank_name}>{b.bank_type}</option>
                ))}
              </datalist>
              <input type="text" list="bank-master-list"
                value={form.bank} onChange={e => setField('bank', e.target.value)}
                required placeholder="기관명 입력 또는 선택"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
              {bankMaster.data.length === 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  자금정책 → 기관한도 탭에서 거래 금융기관을 먼저 등록하면 여기서 선택할 수 있습니다.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">상품유형 *</label>
              <select value={form.product} onChange={e => setField('product', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {PRODUCT_OPTIONS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">통화</label>
              <select value={form.currency} onChange={e => setField('currency', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {CURRENCY_OPTIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">금액 *</label>
              <NumInput value={form.amount} onChange={raw => setField('amount', raw)}
                required placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">수익률 (%)</label>
              <input type="number" step="0.01" value={form.rate} onChange={e => setField('rate', e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">가용 여부</label>
              <select value={form.available} onChange={e => setField('available', e.target.value as '가용' | '불가용')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                <option value="가용">가용</option>
                <option value="불가용">불가용</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">시작일</label>
              <input type="date" value={form.start} onChange={e => setField('start', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">만기일 *</label>
              <input type="date" value={form.maturity} onChange={e => setField('maturity', e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">취득가액</label>
              <NumInput value={form.acquisition_cost} onChange={raw => setField('acquisition_cost', raw)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
          </div>

          {form.amount && form.acquisition_cost && Number(form.acquisition_cost) > 0 && (() => {
            const ret = calcReturn(Number(form.amount), Number(form.acquisition_cost))
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-slate-300">수익률:</span>
                <span className={`text-sm px-2 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                  {fmtReturn(ret)}
                </span>
              </div>
            )
          })()}

          {error   && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">✓ 저장되었습니다.</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '등록'}
          </button>
        </form>
      )}

      {/* FVPL 이관 안내 */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
        📊 <strong>변동성 리스크 분석</strong>은 <strong>자금정책 관리 → 변동성 리스크 탭</strong>에서 확인하세요.
      </div>

      {/* 탭 + 목록 */}
      <div className="bg-white rounded-xl shadow dark:bg-slate-800">
        <div className="flex border-b border-gray-100 dark:border-slate-700">
          {[
            { key: 'active',   label: `운용 중 (${activeList.length})` },
            { key: 'inactive', label: `만기/종료 (${inactiveList.length})` },
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

        <div className="p-4 md:p-5">
          {invest.loading ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">로딩 중...</p>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">데이터가 없습니다.</p>
          ) : (
            <>
              {/* 모바일 카드 리스트 */}
              <div className="md:hidden space-y-3">
                {displayList.map(rec => {
                  const dday = calcDday(rec.maturity)
                  const ret  = calcReturn(rec.amount, rec.acquisition_cost)
                  const urgent = tab === 'active' && dday <= 7
                  const warn   = tab === 'active' && dday > 7 && dday <= 30
                  return (
                    <div key={rec.id}
                      className={`rounded-xl border p-4 ${
                        urgent ? 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
                        : warn  ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800'
                        : 'border-gray-200 dark:border-slate-700'
                      }`}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{rec.bank}</span>
                            <span className="text-xs text-gray-500 dark:text-slate-300">{rec.product}</span>
                          </div>
                          <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rec.available === '가용' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'}`}>{rec.available}</span>
                            {rec.currency !== 'KRW' && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{rec.currency}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtKRW(rec.amount)}</div>
                          {tab === 'active' && (
                            <div className={`text-xs font-semibold mt-0.5 ${urgent ? 'text-red-600 dark:text-red-400' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              D-{dday}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">금리</span><span className="text-gray-700 dark:text-gray-200">{rec.rate ? `${rec.rate}%` : '-'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">만기일</span><span className={`${urgent ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{rec.maturity}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">시작일</span><span className="text-gray-700 dark:text-gray-200">{rec.start}</span></div>
                        {ret !== null && (
                          <div className="flex justify-between items-center"><span className="text-gray-400 dark:text-gray-500">수익률</span><span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span></div>
                        )}
                      </div>
                      {isEditable && (
                        <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                          <button onClick={() => loadRecord(rec)} className="flex-1 text-xs text-blue-600 dark:text-blue-400 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100">수정</button>
                          {tab === 'active'
                            ? <button onClick={() => handleSetActive(rec.id, false)} className="flex-1 text-xs text-amber-600 dark:text-amber-400 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100">만기처리</button>
                            : <button onClick={() => handleSetActive(rec.id, true)} className="flex-1 text-xs text-emerald-600 dark:text-emerald-400 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100">복원</button>
                          }
                          <button onClick={() => handleDelete(rec.id)} className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20">삭제</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* PC 테이블 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700">
                      {['금융기관', '상품', '통화', '금액', '수익률', '가용', '시작일', '만기일', 'D-day', ''].map(h => (
                        <th key={h} className="text-left text-xs text-gray-400 font-medium pb-2 pr-3 whitespace-nowrap dark:text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.map(rec => {
                      const dday = calcDday(rec.maturity)
                      const ret  = calcReturn(rec.amount, rec.acquisition_cost)
                      const urgent = tab === 'active' && dday <= 30
                      return (
                        <tr key={rec.id} className={`border-b border-gray-50 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700 ${urgent ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                          <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap dark:text-gray-100">{rec.bank}</td>
                          <td className="py-2 pr-3 text-gray-600 dark:text-slate-100">{rec.product}</td>
                          <td className="py-2 pr-3 text-gray-500 dark:text-slate-300">{rec.currency}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-800 dark:text-gray-100">{fmtKRW(rec.amount)}</td>
                          <td className="py-2 pr-3">{ret !== null ? <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span> : <span className="text-xs text-gray-400 dark:text-gray-500">{rec.rate ? `${rec.rate}%` : '-'}</span>}</td>
                          <td className="py-2 pr-3"><span className={`text-xs px-1.5 rounded ${rec.available === '가용' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{rec.available}</span></td>
                          <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap dark:text-gray-500">{rec.start}</td>
                          <td className="py-2 pr-3 text-xs text-gray-600 whitespace-nowrap dark:text-slate-100">{rec.maturity}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{tab === 'active' && <span className={`text-xs font-medium ${dday <= 7 ? 'text-red-600' : dday <= 30 ? 'text-amber-600' : 'text-gray-500'}`}>D-{dday}</span>}</td>
                          <td className="py-2 whitespace-nowrap">
                            {isEditable && (
                              <div className="flex gap-1.5">
                                <button onClick={() => loadRecord(rec)} className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                                {tab === 'active' ? <button onClick={() => handleSetActive(rec.id, false)} className="text-xs text-amber-500 hover:text-amber-700">만기</button> : <button onClick={() => handleSetActive(rec.id, true)} className="text-xs text-emerald-500 hover:text-emerald-700">복원</button>}
                                <button onClick={() => handleDelete(rec.id)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

