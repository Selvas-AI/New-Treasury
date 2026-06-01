import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue, normDate } from '../../lib/format'
import { fetchBondPrice } from '../../hooks/useGas'
import type { InvestmentRecord } from '../../types'

interface Props {
  bondName: string
  isin: string
  company: string
  history: InvestmentRecord[]
  onSave: (record: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>
  onRemove: (id: string) => Promise<string | null>
  onBulkAcq: (ids: string[], cost: number) => Promise<string | null>
  isEditable: boolean
}

const EMPTY = {
  priceDate: new Date().toISOString().slice(0, 10),
  bondQty: '',
  bondPrice: '',
  acquisition_cost: '',
  available: '가용' as '가용' | '불가용',
}

export default function BondHistoryPanel({
  bondName, isin, company, history, onSave, onRemove, onBulkAcq, isEditable,
}: Props) {
  const [form, setForm]     = useState({ ...EMPTY })
  const [editId, setEditId] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const evalAmt  = calcBondValue(Number(form.bondQty) || 0, Number(form.bondPrice) || 0)
  const retPreview = calcReturn(evalAmt, Number(form.acquisition_cost) || 0)

  function loadRecord(rec: InvestmentRecord) {
    setEditId(rec.id)
    setForm({
      priceDate:        rec.priceDate || rec.maturity || '',
      bondQty:          String(rec.bondQty          || ''),
      bondPrice:        String(rec.bondPrice         || ''),
      acquisition_cost: String(rec.acquisition_cost || ''),
      available:        rec.available,
    })
  }

  function resetForm() {
    setEditId(null)
    setForm({ ...EMPTY })
    setError(null)
  }

  async function handleFetchPrice() {
    if (!isin) return
    setFetching(true)
    setError(null)
    try {
      const res = await fetchBondPrice(isin)
      setForm(f => ({ ...f, bondPrice: String(res.price), priceDate: normDate(res.date) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 시세 조회 실패 (T+1 제공)')
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company) return
    setSaving(true)
    setError(null)

    const qty   = Number(form.bondQty)   || 0
    const price = Number(form.bondPrice) || 0
    const acq   = Number(form.acquisition_cost) || 0
    const record = {
      ...(editId ? { id: editId } : {}),
      company:          company as InvestmentRecord['company'],
      bank:             bondName,
      product:          '국채' as const,
      currency:         'KRW',
      amount:           calcBondValue(qty, price),
      available:        form.available,
      rate:             0,
      start:            form.priceDate,
      maturity:         '',
      active:           true,
      bondName,
      bondTicker:       isin,
      bondQty:          qty,
      bondPrice:        price,
      priceDate:        form.priceDate,
      acquisition_cost: acq,
    }

    const err = await onSave(record)
    setSaving(false)
    if (err) { setError(err); return }

    if (acq > 0 && !editId) {
      const ids = history.map(h => h.id)
      if (ids.length > 0 && confirm(`"${bondName}" 취득가액을 전체 이력에 반영하시겠습니까?`)) {
        await onBulkAcq(ids, acq)
      }
    }
    resetForm()
  }

  async function handleRemove(id: string) {
    if (!confirm('삭제하시겠습니까?')) return
    await onRemove(id)
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 p-4 space-y-4">

      {isEditable && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">{editId ? '✏️ 수정' : '+ 시세 추가'}</p>
            {editId && (
              <button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-red-400">취소</button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">기준일</label>
              <input type="date" value={form.priceDate}
                onChange={e => setForm(f => ({ ...f, priceDate: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">보유 좌수</label>
              <input type="number" min="0" value={form.bondQty}
                onChange={e => setForm(f => ({ ...f, bondQty: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">기준가 (÷10=1좌당)</label>
              <div className="flex gap-1">
                <input type="number" min="0" step="0.01" value={form.bondPrice}
                  onChange={e => setForm(f => ({ ...f, bondPrice: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button type="button" onClick={handleFetchPrice} disabled={fetching}
                  className="shrink-0 text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 rounded hover:bg-blue-100 disabled:opacity-50">
                  {fetching ? '…' : '조회'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">취득가액 (총액)</label>
              <input type="number" min="0" value={form.acquisition_cost}
                onChange={e => setForm(f => ({ ...f, acquisition_cost: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">가용 여부</label>
            <select value={form.available}
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

          <button type="submit" disabled={saving}
            className="w-full text-xs bg-blue-600 text-white rounded py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '저장'}
          </button>
        </form>
      )}

      {history.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-2">이력이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                {['기준일', '좌수', '기준가', '평가금액', '수익률', '취득가액', '가용', ''].map(h => (
                  <th key={h} className="text-left text-gray-400 font-medium pb-1.5 pr-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map(rec => {
                const val = rec.bondQty && rec.bondPrice
                  ? calcBondValue(rec.bondQty, rec.bondPrice)
                  : rec.amount
                const ret = calcReturn(val, rec.acquisition_cost)
                return (
                  <tr key={rec.id} className="border-b border-gray-100 hover:bg-white">
                    <td className="py-1.5 pr-3 text-gray-700">{rec.priceDate || rec.start}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">{(rec.bondQty || 0).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">{rec.bondPrice || '-'}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-gray-800">{fmtKRW(val)}</td>
                    <td className="py-1.5 pr-3">
                      {ret !== null
                        ? <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span>
                        : <span className="text-gray-300">-</span>
                      }
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-400">
                      {rec.acquisition_cost ? fmtKRW(rec.acquisition_cost) : '-'}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1 rounded ${rec.available === '가용' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {rec.available}
                      </span>
                    </td>
                    <td className="py-1.5 whitespace-nowrap">
                      {isEditable && (
                        <div className="flex gap-1.5">
                          <button onClick={() => loadRecord(rec)} className="text-blue-400 hover:text-blue-600">수정</button>
                          <button onClick={() => handleRemove(rec.id)} className="text-red-300 hover:text-red-500">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
