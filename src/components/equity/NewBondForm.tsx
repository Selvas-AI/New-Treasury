import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue, normDate } from '../../lib/format'
import { fetchBondByName, fetchBondPrice } from '../../hooks/useGas'
import type { InvestmentRecord } from '../../types'

interface Props {
  company: string
  onSave: (record: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>
  isEditable: boolean
}

const EMPTY = {
  bondName: '',
  bondTicker: '',
  priceDate: new Date().toISOString().slice(0, 10),
  bondQty: '',
  bondPrice: '',
  acquisition_cost: '',
  available: '가용' as '가용' | '불가용',
}

export default function NewBondForm({ company, onSave, isEditable }: Props) {
  const [open, setOpen]         = useState(false)
  const [form, setForm]         = useState({ ...EMPTY })
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [candidates, setCandidates] = useState<{ isin: string; name: string }[]>([])

  const evalAmt    = calcBondValue(Number(form.bondQty) || 0, Number(form.bondPrice) || 0)
  const retPreview = calcReturn(evalAmt, Number(form.acquisition_cost) || 0)

  function reset() {
    setForm({ ...EMPTY })
    setError(null)
    setCandidates([])
    setOpen(false)
  }

  /** 채권명 blur → GAS 이름 검색 → ISIN + 기준가 자동입력 */
  async function handleNameSearch() {
    if (!form.bondName.trim()) return
    setFetching(true)
    setError(null)
    setCandidates([])
    try {
      const res = await fetchBondByName(form.bondName.trim())
      setForm(f => ({
        ...f,
        bondTicker: res.isin,
        bondPrice:  String(res.price),
        priceDate:  normDate(res.date),
      }))
      if (res.candidates.length > 1) {
        setCandidates(res.candidates)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 조회 실패')
    }
    setFetching(false)
  }

  /** 후보 선택 → 해당 채권으로 기준가 재조회 */
  async function handleCandidatePick(c: { isin: string; name: string }) {
    setCandidates([])
    setFetching(true)
    setError(null)
    try {
      const res = await fetchBondPrice(c.isin)
      setForm(f => ({
        ...f,
        bondName:   c.name,
        bondTicker: c.isin,
        bondPrice:  String(res.price),
        priceDate:  normDate(res.date),
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 기준가 조회 실패')
    }
    setFetching(false)
  }

  /** ISIN blur → 기준가만 재조회 (수동 입력 대비) */
  async function handleIsinSearch() {
    if (!form.bondTicker) return
    setFetching(true)
    setError(null)
    try {
      const res = await fetchBondPrice(form.bondTicker)
      setForm(f => ({ ...f, bondPrice: String(res.price), priceDate: normDate(res.date) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 시세 조회 실패 (T+1 제공)')
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company || !form.bondName.trim()) { setError('채권명을 입력하세요.'); return }
    setSaving(true)
    setError(null)

    const qty   = Number(form.bondQty)   || 0
    const price = Number(form.bondPrice) || 0
    const acq   = Number(form.acquisition_cost) || 0

    const record = {
      company:          company as InvestmentRecord['company'],
      bank:             form.bondName.trim(),
      product:          '국채' as const,
      currency:         'KRW',
      amount:           calcBondValue(qty, price),
      available:        form.available,
      rate:             0,
      start:            form.priceDate,
      maturity:         '',
      active:           true,
      bondName:         form.bondName.trim(),
      bondTicker:       form.bondTicker.trim() || undefined,
      bondQty:          qty,
      bondPrice:        price,
      priceDate:        form.priceDate,
      acquisition_cost: acq,
    }

    const err = await onSave(record)
    setSaving(false)
    if (err) { setError(err); return }
    reset()
  }

  if (!isEditable) return null

  return (
    <div className="px-4 pt-3 pb-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
          <span className="text-base leading-none">+</span>
          국채/채권 신규 등록
        </button>
      ) : (
        <form onSubmit={handleSave} className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-blue-700">국채/채권 신규 등록</p>
            <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-red-400">취소</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 채권명 — 입력 후 blur 시 자동 검색 */}
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">
                채권명 <span className="text-red-400">*</span>
                {fetching && <span className="ml-1 text-blue-400 animate-pulse">시세 조회 중… (최대 30초)</span>}
              </label>
              <input
                type="text"
                value={form.bondName}
                onChange={e => { setForm(f => ({ ...f, bondName: e.target.value })); setCandidates([]) }}
                onBlur={handleNameSearch}
                placeholder="예: 국고채권 (입력 후 자동 조회)"
                required
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* 후보 드롭다운 */}
              {candidates.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-white border border-blue-200 rounded-lg shadow-lg overflow-hidden">
                  <p className="text-[10px] text-gray-400 px-2 pt-1.5 pb-0.5">검색 결과 — 선택하세요</p>
                  {candidates.map(c => (
                    <button
                      key={c.isin}
                      type="button"
                      onClick={() => void handleCandidatePick(c)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-gray-800 truncate">{c.name}</span>
                      <span className="text-gray-400 shrink-0 text-[10px]">{c.isin}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCandidates([])}
                    className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 py-1 border-t border-gray-100"
                  >닫기</button>
                </div>
              )}
            </div>

            {/* ISIN — 자동입력, 수동 수정 가능 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">ISIN (자동입력 · 수정가능)</label>
              <input
                type="text"
                value={form.bondTicker}
                onChange={e => setForm(f => ({ ...f, bondTicker: e.target.value }))}
                onBlur={handleIsinSearch}
                placeholder="예: KR103502GCC5"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준일 (자동입력)</label>
              <input
                type="date"
                value={form.priceDate}
                onChange={e => setForm(f => ({ ...f, priceDate: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">보유 좌수</label>
              <input
                type="number" min="0"
                value={form.bondQty}
                onChange={e => setForm(f => ({ ...f, bondQty: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준가 (자동입력 · 수정가능)</label>
              <div className="flex gap-1">
                <input
                  type="number" min="0" step="0.01"
                  value={form.bondPrice}
                  onChange={e => setForm(f => ({ ...f, bondPrice: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {form.bondTicker && (
                  <button
                    type="button" onClick={handleIsinSearch} disabled={fetching}
                    title="기준가 재조회"
                    className="shrink-0 text-xs bg-white text-blue-600 border border-blue-200 px-2 rounded hover:bg-blue-50 disabled:opacity-50">
                    {fetching ? '…' : '↺'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">취득가액 (총액)</label>
              <input
                type="number" min="0"
                value={form.acquisition_cost}
                onChange={e => setForm(f => ({ ...f, acquisition_cost: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">가용 여부</label>
            <select
              value={form.available}
              onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
              className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="가용">가용</option>
              <option value="불가용">불가용</option>
            </select>
          </div>

          {evalAmt > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">평가금액: <strong>{fmtKRW(evalAmt)}</strong></span>
              {retPreview !== null && (
                <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(retPreview)}`}>
                  {fmtReturn(retPreview)}
                </span>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit" disabled={saving}
            className="w-full text-xs bg-blue-600 text-white rounded py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : '채권 등록'}
          </button>
        </form>
      )}
    </div>
  )
}
