import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDaily } from '../hooks/useDaily'
import { useFx } from '../hooks/useFx'
import { fmtKRW, normDate } from '../lib/format'
import { isTodayBusinessDay } from '../lib/bizDay'
import { getCompanyNames } from '../hooks/useCompanies'
import type { DailyRecord, Company, FxCode } from '../types'

const FX_FIELDS: { key: FxCode; label: string }[] = [
  { key: 'USD', label: 'USD' },
  { key: 'EUR', label: 'EUR' },
  { key: 'JPY', label: 'JPY' },
  { key: 'GBP', label: 'GBP' },
  { key: 'CNY', label: 'CNY' },
]

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  writer: '',
  krw_demand: '',
  krw_govt: '',
  krw_mmda: '',
  fx_usd: '',
  fx_eur: '',
  fx_jpy: '',
  fx_gbp: '',
  fx_cny: '',
  memo: '',
}

type FormState = typeof EMPTY_FORM

export default function InputPage() {
  const { company: paramCompany, date: paramDate } = useParams<{ company?: string; date?: string }>()
  const { user, currentCompany, setCurrentCompany, canEdit, canAction } = useAuth()
  const { data, loading, upsert, remove } = useDaily()
  const fx = useFx()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // URL 파라미터로 법인 자동 전환
  useEffect(() => {
    if (!paramCompany || user?.role === 'company') return
    if (getCompanyNames().includes(paramCompany)) {
      setCurrentCompany(paramCompany as Company)
    }
  }, [paramCompany, user?.role, setCurrentCompany])

  // URL 파라미터로 날짜 자동 세팅
  useEffect(() => {
    if (paramDate) setForm(f => ({ ...f, date: normDate(paramDate) }))
  }, [paramDate])

  // 로그인 사용자 이름 기본값
  useEffect(() => {
    if (user?.label) setForm(f => ({ ...f, writer: f.writer || user.label }))
  }, [user])

  // 환율 로드
  useEffect(() => { void fx.fetchRates() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // fx_krw 자동 계산
  const calcFxKrw = useMemo(() => {
    const usd = Number(form.fx_usd) || 0
    const eur = Number(form.fx_eur) || 0
    const jpy = Number(form.fx_jpy) || 0
    const gbp = Number(form.fx_gbp) || 0
    const cny = Number(form.fx_cny) || 0
    return (
      fx.toKRW(usd, 'USD') +
      fx.toKRW(eur, 'EUR') +
      fx.toKRW(jpy, 'JPY') +
      fx.toKRW(gbp, 'GBP') +
      fx.toKRW(cny, 'CNY')
    )
  }, [form.fx_usd, form.fx_eur, form.fx_jpy, form.fx_gbp, form.fx_cny, fx])

  // 합계
  const totalKrw = useMemo(() => {
    return (
      (Number(form.krw_demand) || 0) +
      (Number(form.krw_govt)   || 0) +
      (Number(form.krw_mmda)   || 0) +
      calcFxKrw
    )
  }, [form.krw_demand, form.krw_govt, form.krw_mmda, calcFxKrw])

  function setField(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function loadRecord(rec: DailyRecord) {
    setEditId(rec.id)
    setForm({
      date:       rec.date,
      writer:     rec.writer,
      krw_demand: String(rec.krw_demand || ''),
      krw_govt:   String(rec.krw_govt   || ''),
      krw_mmda:   String(rec.krw_mmda   || ''),
      fx_usd:     String(rec.fx_usd     || ''),
      fx_eur:     String(rec.fx_eur     || ''),
      fx_jpy:     String(rec.fx_jpy     || ''),
      fx_gbp:     String(rec.fx_gbp     || ''),
      fx_cny:     String(rec.fx_cny     || ''),
      memo:       rec.memo || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, writer: user?.label || '', date: new Date().toISOString().slice(0, 10) })
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
      date:       normDate(form.date),
      writer:     form.writer,
      krw_demand: Number(form.krw_demand) || 0,
      krw_govt:   Number(form.krw_govt)   || 0,
      krw_mmda:   Number(form.krw_mmda)   || 0,
      fx_usd:     Number(form.fx_usd)     || 0,
      fx_eur:     Number(form.fx_eur)     || 0,
      fx_jpy:     Number(form.fx_jpy)     || 0,
      fx_gbp:     Number(form.fx_gbp)     || 0,
      fx_cny:     Number(form.fx_cny)     || 0,
      fx_krw:     calcFxKrw,
      memo:       form.memo,
    }

    try {
      const err = await upsert(record)
      if (err) { setError(err); return }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
      resetForm()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return
    const err = await remove(id)
    if (err) setError(err)
  }

  const today = new Date().toISOString().slice(0, 10)
  const isEditable = canEdit() && canAction('operating', 'write')

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">운전자금 입력</h2>
        {!isTodayBusinessDay() && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 px-2.5 py-1 rounded-md">
            오늘은 비영업일입니다
          </span>
        )}
      </div>

      {/* 입력 폼 */}
      {isEditable && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 space-y-5 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {editId ? '✏️ 수정 중' : '+ 새로 입력'}
            </h3>
            {editId && (
              <button type="button" onClick={resetForm}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500">
                취소
              </button>
            )}
          </div>

          {/* 날짜 / 작성자 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">기준일 *</label>
              <input type="date" value={form.date} onChange={e => setField('date', e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">작성자 *</label>
              <input type="text" value={form.writer} onChange={e => setField('writer', e.target.value)}
                required placeholder="이름"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100 dark:placeholder-gray-400" />
            </div>
          </div>

          {/* 원화 잔고 */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">원화 잔고 (원)</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { key: 'krw_demand' as const, label: '보통예금/CMA' },
                { key: 'krw_govt'   as const, label: '국책자금'     },
                { key: 'krw_mmda'   as const, label: '증권 예수금'  },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="number" min="0" value={form[f.key]}
                    onChange={e => setField(f.key, e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 외화 잔고 */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">외화 잔고</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {FX_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form[`fx_${f.key.toLowerCase()}` as keyof FormState]}
                    onChange={e => setField(`fx_${f.key.toLowerCase()}` as keyof FormState, e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100"
                  />
                </div>
              ))}
            </div>
            {calcFxKrw > 0 && (
              <p className="text-xs text-blue-600 mt-1.5">
                외화 원화환산 합계: <strong>{fmtKRW(calcFxKrw)}</strong>
                {fx.rates.length === 0 && <span className="text-gray-400 ml-1">(환율 미로드)</span>}
              </p>
            )}
          </div>

          {/* 합계 미리보기 */}
          <div className="bg-blue-50 rounded-lg px-4 py-3 flex items-center justify-between dark:bg-blue-950/30 dark:border dark:border-blue-800">
            <span className="text-sm text-blue-700 dark:text-blue-300">운전자금 합계 (추정)</span>
            <span className="text-lg font-bold text-blue-800 dark:text-blue-300">{fmtKRW(totalKrw)}</span>
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">메모</label>
            <textarea
              value={form.memo} onChange={e => setField('memo', e.target.value)}
              rows={2} placeholder="비고 사항"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100 dark:placeholder-gray-400"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">✓ 저장되었습니다.</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '저장'}
          </button>
        </form>
      )}

      {/* 이력 */}
      <div className="bg-white rounded-xl shadow p-5 dark:bg-slate-800">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-100 mb-4">입력 이력</h3>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">로딩 중...</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">입력된 데이터가 없습니다.</p>
        ) : (
          <>
            {/* 모바일 카드 리스트 */}
            <div className="md:hidden space-y-3">
              {data.map(rec => {
                const total = (rec.krw_demand || 0) + (rec.krw_govt || 0) + (rec.krw_mmda || 0) + (rec.fx_krw || 0)
                const isToday = rec.date === today
                return (
                  <div key={rec.id}
                    className={`rounded-xl border p-4 ${isToday ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-700' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{rec.date}</span>
                        {isToday && <span className="text-xs text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">오늘</span>}
                      </div>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{fmtKRW(total)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
                      <div className="flex justify-between">
                        <span className="text-gray-400 dark:text-gray-500">보통예금</span>
                        <span className="text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(rec.krw_demand)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 dark:text-gray-500">국책자금</span>
                        <span className="text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(rec.krw_govt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 dark:text-gray-500">예수금</span>
                        <span className="text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(rec.krw_mmda)}</span>
                      </div>
                      {(rec.fx_krw || 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-400 dark:text-gray-500">외화환산</span>
                          <span className="text-blue-600 dark:text-blue-400 tabular-nums">{fmtKRW(rec.fx_krw)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{rec.writer}</span>
                      {isEditable && (
                        <div className="flex gap-2">
                          <button onClick={() => loadRecord(rec)}
                            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30">수정</button>
                          <button onClick={() => handleDelete(rec.id)}
                            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded bg-red-50 dark:bg-red-900/20">삭제</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* PC 테이블 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    {['기준일', '보통예금', '국책자금', '예수금', '외화환산', '합계', '작성자', ''].map(h => (
                      <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium pb-2 pr-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map(rec => {
                    const total = (rec.krw_demand || 0) + (rec.krw_govt || 0) + (rec.krw_mmda || 0) + (rec.fx_krw || 0)
                    const isToday = rec.date === today
                    return (
                      <tr key={rec.id}
                        className={`border-b border-gray-50 dark:border-slate-700/50 hover:bg-gray-50 dark:hover:bg-slate-700 ${isToday ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}>
                        <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
                          {rec.date}{isToday && <span className="ml-1 text-xs text-blue-500 dark:text-blue-400">오늘</span>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtKRW(rec.krw_demand)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtKRW(rec.krw_govt)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtKRW(rec.krw_mmda)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-500 dark:text-slate-300">{fmtKRW(rec.fx_krw)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">{fmtKRW(total)}</td>
                        <td className="py-2 pr-3 text-gray-500 dark:text-slate-300 whitespace-nowrap">{rec.writer}</td>
                        <td className="py-2 whitespace-nowrap">
                          {isEditable && (
                            <div className="flex gap-1.5">
                              <button onClick={() => loadRecord(rec)} className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">수정</button>
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
  )
}

