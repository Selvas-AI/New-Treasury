import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn } from '../../lib/format'
import { fetchStockByName, fetchStockPrice } from '../../hooks/useGas'
import type { EquityRecord } from '../../types'

interface Props {
  company: string
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
  const [open, setOpen]         = useState(false)
  const [form, setForm]         = useState({ ...EMPTY, market: fixedMarket ?? 'KOSPI' as 'KOSPI' | 'KOSDAQ' | '비상장' })
  const market                  = fixedMarket ?? form.market
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [candidates, setCandidates] = useState<{ ticker: string; name: string; market: string }[]>([])

  const totalValue = Number(form.shares) * Number(form.price) || 0
  const retPreview = calcReturn(totalValue, Number(form.acquisition_cost) || 0)

  function reset() {
    setForm({ ...EMPTY, market: fixedMarket ?? 'KOSPI' })
    setError(null)
    setCandidates([])
    setOpen(false)
  }

  /** 종목명 blur → GAS 이름 검색 → 티커/시장/주가 자동입력 */
  async function handleNameSearch() {
    if (!form.name.trim() || market === '비상장') return
    setFetching(true)
    setError(null)
    setCandidates([])
    try {
      const res = await fetchStockByName(form.name.trim())
      setForm(f => ({
        ...f,
        ticker: res.ticker,
        market: (res.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI') as 'KOSPI' | 'KOSDAQ' | '비상장',
        price:  String(res.price),
        date:   res.date,
      }))
      // 후보가 2개 이상이면 선택 드롭다운 표시
      if (res.candidates.length > 1) {
        setCandidates(res.candidates)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '종목 조회 실패')
    }
    setFetching(false)
  }

  /** 후보 선택 → 해당 종목으로 주가 재조회 */
  async function handleCandidatePick(c: { ticker: string; name: string; market: string }) {
    setCandidates([])
    setFetching(true)
    setError(null)
    try {
      const res = await fetchStockPrice(c.ticker)
      setForm(f => ({
        ...f,
        name:   c.name,
        ticker: c.ticker,
        market: (c.market as 'KOSPI' | 'KOSDAQ' | '비상장'),
        price:  String(res.price),
        date:   res.date,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '주가 조회 실패')
    }
    setFetching(false)
  }

  /** 티커 blur → 주가만 재조회 (이름 검색 실패 후 수동 입력 대비) */
  async function handleTickerSearch() {
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
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">
                종목명 <span className="text-red-400">*</span>
                {fetching && <span className="ml-1 text-blue-400 animate-pulse">시세 조회 중… (최대 30초)</span>}
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setCandidates([]) }}
                onBlur={handleNameSearch}
                placeholder={market === '비상장' ? '예: 비상장법인명' : '예: 셀바스AI (입력 후 자동 조회)'}
                required
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* 후보 드롭다운 */}
              {candidates.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-white border border-blue-200 rounded-lg shadow-lg overflow-hidden">
                  <p className="text-[10px] text-gray-400 px-2 pt-1.5 pb-0.5">검색 결과 — 선택하세요</p>
                  {candidates.map(c => (
                    <button
                      key={c.ticker}
                      type="button"
                      onClick={() => void handleCandidatePick(c)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-gray-800">{c.name}</span>
                      <span className="text-gray-400 shrink-0">{c.ticker} · {c.market}</span>
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

            {market !== '비상장' ? (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">티커 (자동입력 · 수정가능)</label>
                  <input
                    type="text"
                    value={form.ticker}
                    onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                    onBlur={handleTickerSearch}
                    placeholder="예: 108860"
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                {!fixedMarket && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">시장 (자동입력)</label>
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
              <label className="block text-xs text-gray-500 mb-1">기준일 (자동입력)</label>
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
              <label className="block text-xs text-gray-500 mb-1">주가 (자동입력 · 수정가능)</label>
              <div className="flex gap-1">
                <input
                  type="number" min="0"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {market !== '비상장' && form.ticker && (
                  <button
                    type="button" onClick={handleTickerSearch} disabled={fetching}
                    title="주가 재조회"
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
