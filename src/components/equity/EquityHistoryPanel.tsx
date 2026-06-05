import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn } from '../../lib/format'
import { fetchStockPrice } from '../../hooks/useGas'
import type { EquityRecord } from '../../types'
import { NotionTable, type ColumnDef } from '../common/NotionTable'

interface Props {
  name: string
  ticker: string
  market: string
  company: string
  history: EquityRecord[]
  onSave: (record: Omit<EquityRecord, 'id'> & { id?: string }) => Promise<string | null>
  onRemove: (id: string) => Promise<string | null>
  onBulkAcq: (name: string, cost: number) => Promise<string | null>
  isEditable: boolean
}

const EMPTY = {
  date: new Date().toISOString().slice(0, 10),
  shares: '',
  price: '',
  acquisition_cost: '',
  purpose: '',
  available: '가용' as '가용' | '불가용',
}

export default function EquityHistoryPanel({
  name, ticker, market, company, history, onSave, onRemove, onBulkAcq, isEditable,
}: Props) {
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalValue = Number(form.shares) * Number(form.price) || 0
  const retPreview = calcReturn(totalValue, Number(form.acquisition_cost) || 0)

  function loadRecord(rec: EquityRecord) {
    setEditId(rec.id)
    setForm({
      date:             rec.date,
      shares:           String(rec.shares           || ''),
      price:            String(rec.price            || ''),
      acquisition_cost: String(rec.acquisition_cost || ''),
      purpose:          rec.purpose || '',
      available:        rec.available,
    })
  }

  function resetForm() {
    setEditId(null)
    setForm({ ...EMPTY })
    setError(null)
  }

  async function handleFetchPrice() {
    if (!ticker || market === '비상장') return
    setFetching(true)
    setError(null)
    try {
      const res = await fetchStockPrice(ticker)
      setForm(f => ({ ...f, price: String(res.price), date: res.date }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '시세 조회 실패')
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company) return
    setSaving(true)
    setError(null)

    const shares = Number(form.shares) || 0
    const price  = Number(form.price)  || 0
    const record = {
      ...(editId ? { id: editId } : {}),
      company:          company as EquityRecord['company'],
      name, ticker, market: market as EquityRecord['market'],
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

    // 취득가액 입력된 경우 일괄반영 여부 확인
    if (record.acquisition_cost > 0 && !editId) {
      if (confirm(`"${name}" 의 취득가액을 과거 이력 전체에도 반영하시겠습니까?`)) {
        await onBulkAcq(name, record.acquisition_cost)
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

      {/* 신규/수정 폼 */}
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
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">보유 주수</label>
              <input type="number" min="0" value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">주가 (원)</label>
              <div className="flex gap-1">
                <input type="number" min="0" value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {market !== '비상장' && ticker && (
                  <button type="button" onClick={handleFetchPrice} disabled={fetching}
                    className="shrink-0 text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 rounded hover:bg-blue-100 disabled:opacity-50">
                    {fetching ? '…' : '조회'}
                  </button>
                )}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">투자목적</label>
              <input type="text" value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                placeholder="전략적 투자 등"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">가용 여부</label>
              <select value={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
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

          <button type="submit" disabled={saving}
            className="w-full text-xs bg-blue-600 text-white rounded py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '저장'}
          </button>
        </form>
      )}

      {/* 이력 테이블 */}
      {(() => {
        const columns: ColumnDef<EquityRecord, unknown>[] = [
          { accessorKey: 'date', header: '기준일' },
          {
            accessorKey: 'shares',
            header: '주수',
            cell: ({ getValue }) => (
              <span className="tabular-nums text-gray-600">{getValue<number>().toLocaleString()}</span>
            ),
          },
          {
            accessorKey: 'price',
            header: '주가',
            cell: ({ getValue }) => (
              <span className="tabular-nums text-gray-600">{getValue<number>().toLocaleString()}원</span>
            ),
          },
          {
            accessorKey: 'total_value',
            header: '평가금액',
            cell: ({ getValue }) => (
              <span className="tabular-nums font-medium text-gray-800">{fmtKRW(getValue<number>())}</span>
            ),
          },
          {
            id: 'return',
            header: '수익률',
            accessorFn: row => calcReturn(row.total_value, row.acquisition_cost) ?? -Infinity,
            cell: ({ row }) => {
              const ret = calcReturn(row.original.total_value, row.original.acquisition_cost)
              return ret !== null
                ? <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span>
                : <span className="text-gray-300">-</span>
            },
          },
          {
            accessorKey: 'acquisition_cost',
            header: '취득가액',
            cell: ({ getValue }) => {
              const v = getValue<number>()
              return <span className="tabular-nums text-gray-400">{v ? fmtKRW(v) : '-'}</span>
            },
          },
          {
            accessorKey: 'available',
            header: '가용',
            cell: ({ getValue }) => {
              const v = getValue<string>()
              return (
                <span className={`px-1 rounded ${v === '가용' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                  {v}
                </span>
              )
            },
          },
          ...(isEditable ? [{
            id: 'actions',
            header: '',
            enableSorting: false,
            cell: ({ row }: { row: { original: EquityRecord } }) => (
              <div className="flex gap-1.5">
                <button onClick={() => loadRecord(row.original)} className="text-blue-400 hover:text-blue-600">수정</button>
                <button onClick={() => handleRemove(row.original.id)} className="text-red-300 hover:text-red-500">삭제</button>
              </div>
            ),
          } as ColumnDef<EquityRecord, unknown>] : []),
        ]
        return (
          <NotionTable<EquityRecord>
            tableId="equity_history"
            columns={columns}
            data={history}
            emptyText="이력이 없습니다."
          />
        )
      })()}
    </div>
  )
}
