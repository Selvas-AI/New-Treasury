import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue, normDate } from '../../lib/format'
import { fetchBondPrice } from '../../hooks/useGas'
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

  const evalAmt    = calcBondValue(Number(form.bondQty) || 0, Number(form.bondPrice) || 0)
  const retPreview = calcReturn(evalAmt, Number(form.acquisition_cost) || 0)

  function reset() {
    setForm({ ...EMPTY })
    setError(null)
    setOpen(false)
  }

  async function handleFetchPrice() {
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">채권명 <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.bondName}
                onChange={e => setForm(f => ({ ...f, bondName: e.target.value }))}
                placeholder="예: 국고채권 03250-2712(22-14)"
                required
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ISIN (종목코드)</label>
              <input
                type="text"
                value={form.bondTicker}
                onChange={e => setForm(f => ({ ...f, bondTicker: e.target.value }))}
                placeholder="예: KR103502GCC5"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준일</label>
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
              <label className="block text-xs text-gray-500 mb-1">기준가 (÷10=1좌당)</label>
              <div className="flex gap-1">
                <input
                  type="number" min="0" step="0.01"
                  value={form.bondPrice}
                  onChange={e => setForm(f => ({ ...f, bondPrice: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {form.bondTicker && (
                  <button
                    type="button" onClick={handleFetchPrice} disabled={fetching}
                    className="shrink-0 text-xs bg-white text-blue-600 border border-blue-200 px-2 rounded hover:bg-blue-50 disabled:opacity-50">
                    {fetching ? '…' : '조회'}
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
