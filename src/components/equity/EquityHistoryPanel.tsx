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

// 정수 필드 천단위 포맷 헬퍼
function fmtInt(val: string): string {
  const n = val.replace(/[^0-9]/g, '')
  return n ? Number(n).toLocaleString() : ''
}
function parseIntStr(val: string): number {
  return Number(val.replace(/[^0-9]/g, '')) || 0
}
// 주가: 정수 천단위 포맷
function fmtPrice(val: string): string {
  return fmtInt(val)
}
function parsePriceStr(val: string): number {
  return parseIntStr(val)
}

const EMPTY = {
  date: new Date().toISOString().slice(0, 10),
  shares: '',
  price: '',
  acquisition_cost: '',
  purpose: '',
  available: '가용' as '가용' | '불가용',
}

function prefillFromHistory(history: EquityRecord[]) {
  if (!history.length) return { ...EMPTY }
  const latest = history.reduce((best, r) => (r.date > best.date ? r : best))
  return {
    date:             new Date().toISOString().slice(0, 10),
    shares:           latest.shares           > 0 ? Number(latest.shares).toLocaleString()           : '',
    price:            '',
    acquisition_cost: latest.acquisition_cost > 0 ? Number(latest.acquisition_cost).toLocaleString() : '',
    purpose:          latest.purpose ?? '',
    available:        latest.available ?? '가용' as '가용' | '불가용',
  }
}

export default function EquityHistoryPanel({
  name, ticker, market, company, history, onSave, onRemove, onBulkAcq, isEditable,
}: Props) {
  const [form, setForm] = useState(() => prefillFromHistory(history))
  const [editId, setEditId] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalValue = parseIntStr(form.shares) * parsePriceStr(form.price)
  const retPreview = calcReturn(totalValue, parseIntStr(form.acquisition_cost))

  function loadRecord(rec: EquityRecord) {
    setEditId(rec.id)
    setForm({
      date:             rec.date,
      shares:           rec.shares           ? Number(rec.shares).toLocaleString()           : '',
      price:            rec.price            ? Number(rec.price).toLocaleString()            : '',
      acquisition_cost: rec.acquisition_cost ? Number(rec.acquisition_cost).toLocaleString() : '',
      purpose:          rec.purpose || '',
      available:        rec.available,
    })
  }

  function resetForm() {
    setEditId(null)
    setForm(prefillFromHistory(history))
    setError(null)
  }

  async function handleFetchPrice() {
    if (!ticker || market === '비상장') return
    setFetching(true)
    setError(null)
    try {
      // 기준일자가 오늘이 아니면 해당 날짜의 과거 종가 조회
      const todayStr = new Date().toISOString().slice(0, 10)
      const basDt = form.date && form.date !== todayStr ? form.date : undefined
      const res = await fetchStockPrice(ticker, basDt)
      // 가격만 업데이트 (기준일자는 사용자가 설정한 값 유지, API 반환 날짜 참고용)
      setForm(f => ({ ...f, price: Number(res.price).toLocaleString() }))
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

    const shares = parseIntStr(form.shares)
    const price  = parsePriceStr(form.price)
    const record = {
      ...(editId ? { id: editId } : {}),
      company:          company as EquityRecord['company'],
      name, ticker, market: market as EquityRecord['market'],
      purpose:          form.purpose,
      available:        form.available,
      shares, price,
      total_value:      shares * price,
      date:             form.date,
      acquisition_cost: parseIntStr(form.acquisition_cost),
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
              <input type="text" inputMode="numeric" value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: fmtInt(e.target.value) }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">주가 (원)</label>
              <div className="flex gap-1">
                <input type="text" inputMode="numeric" value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: fmtPrice(e.target.value) }))}
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
              <input type="text" inputMode="numeric" value={form.acquisition_cost}
                onChange={e => setForm(f => ({ ...f, acquisition_cost: fmtInt(e.target.value) }))}
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
