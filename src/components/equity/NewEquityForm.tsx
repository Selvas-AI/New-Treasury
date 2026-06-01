import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn } from '../../lib/format'
import { fetchStockPrice } from '../../hooks/useGas'
import type { EquityRecord } from '../../types'

interface Props {
  company: string
  /** 고정 시장. 미지정 시 KOSPI/KOSDAQ 중 선택 가능 */
  fixedMarket?: 'KOSPI' | 'KOSDAQ' | '비상장'
  onSave: (record: Omit<EquityRecord, 'id'> & { id?: string }) => Promise<string | null>
  isEditable: boolean
}

const EMPTY = {
  name: '',
  ticker: '',
  market: 'KOSPI' as 'KOSPI' | 'KOSDAQ' | '비상장',
  purpose: '',
  date: new Date().toISOString().slice(0, 10),
  shares: '',
  price: '',
  acquisition_cost: '',
  available: '가용' as '가용' | '불가용',
}

export default function NewEquityForm({ company, fixedMarket, onSave, isEditable }: Props) {
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState({ ...EMPTY, market: fixedMarket ?? 'KOSPI' as 'KOSPI' | 'KOSDAQ' | '비상장' })
  const market = fixedMarket ?? form.market
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const totalValue = Number(form.shares) * Number(form.price) || 0
  const retPreview = calcReturn(totalValue, Number(form.acquisition_cost) || 0)

  function reset() {
    setForm({ ...EMPTY, market: fixedMarket ?? 'KOSPI' })
    setError(null)
    setOpen(false)
  }

  async function handleFetchPrice() {
    if (!form.ticker || market === '비상장') return
    setFetching(true)
    setError(null)
    try {
      const res = await fetchStockPrice(form.ticker)
      setForm(f => ({ ...f, price: String(res.price), date: res.date }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '시세 조회 실패')
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company || !form.name.trim()) { setError('종목명을 입력하세요.'); return }
    setSaving(true)
    setError(null)

    const shares = Number(form.shares) || 0
    const price  = Number(form.price)  || 0
    const record = {
      company:          company as EquityRecord['company'],
      name:             form.name.trim(),
      ticker:           form.ticker.trim(),
      market:           market as EquityRecord['market'],
      purpose:          form.purpose,
      available:        form.available,
      shares, price,
      total_value:      shares * price,
      date:             form.date,
      acquisition_cost: Number(form.acquisition_cost) || 0,
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
          {fixedMarket === '비상장' ? '비상장 종목 신규 등록' : fixedMarket ? `${fixedMarket} 종목 신규 등록` : '지분(상장) 신규 등록'}
        </button>
      ) : (
        <form onSubmit={handleSave} className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-blue-700">
              {fixedMarket === '비상장' ? '비상장 종목 신규 등록' : fixedMarket ? `${fixedMarket} 종목 신규 등록` : '지분(상장) 신규 등록'}
            </p>
            <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-red-400">취소</button>
          </div>

          {/* 종목 기본 정보 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">종목명 <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: 삼성전자"
                required
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            {market !== '비상장' ? (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">티커 (종목코드)</label>
                  <input
                    type="text"
                    value={form.ticker}
                    onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                    placeholder="예: 005930"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                {!fixedMarket && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">시장</label>
                    <select
                      value={form.market}
                      onChange={e => setForm(f => ({ ...f, market: e.target.value as 'KOSPI' | 'KOSDAQ' }))}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="KOSPI">KOSPI</option>
                      <option value="KOSDAQ">KOSDAQ</option>
                    </select>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1">투자목적</label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder="전략적 투자 등"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            )}
          </div>

          {/* 수량/가격 정보 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준일</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">보유 주수</label>
              <input
                type="number" min="0"
                value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">주가 (원)</label>
              <div className="flex gap-1">
                <input
                  type="number" min="0"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {market !== '비상장' && form.ticker && (
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

          {/* 투자목적(상장용) + 가용여부 */}
          <div className="grid grid-cols-2 gap-3">
            {market !== '비상장' && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">투자목적</label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder="전략적 투자 등"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">가용 여부</label>
              <select
                value={form.available}
                onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="가용">가용</option>
                <option value="불가용">불가용</option>
              </select>
            </div>
          </div>

          {/* 미리보기 */}
          {totalValue > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">평가금액: <strong>{fmtKRW(totalValue)}</strong></span>
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
            {saving ? '저장 중...' : '종목 등록'}
          </button>
        </form>
      )}
    </div>
  )
}
