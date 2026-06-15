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
    <div className="bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700 p-4 space-y-4">

      {/* 신규/수정 폼 */}
      {isEditable && (
        <form onSubmit={handleSave} className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600 dark:text-slate-100">{editId ? '✏️ 수정' : '+ 시세 추가'}</p>
            {editId && (
              <button type="button" onClick={resetForm} className="text-xs text-gray-400 hover:text-red-400">취소</button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">기준일</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">보유 주수</label>
              <input type="text" inputMode="numeric" value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: fmtInt(e.target.value) }))}
                placeholder="0"
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs text-right bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">주가 (원)</label>
              <div className="flex gap-1">
                <input type="text" inputMode="numeric" value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: fmtPrice(e.target.value) }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs text-right bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {market !== '비상장' && ticker && (
                  <button type="button" onClick={handleFetchPrice} disabled={fetching}
                    className="shrink-0 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50">
                    {fetching ? '…' : '조회'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">취득가액 (총액)</label>
              <input type="text" inputMode="numeric" value={form.acquisition_cost}
                onChange={e => setForm(f => ({ ...f, acquisition_cost: fmtInt(e.target.value) }))}
                placeholder="0"
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs text-right bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">투자목적</label>
              <input type="text" value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                placeholder="전략적 투자 등"
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">가용 여부</label>
              <select value={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="가용">가용</option>
                <option value="불가용">불가용</option>
              </select>
            </div>
          </div>

          {/* 미리보기 */}
          {totalValue > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500 dark:text-slate-300">평가금액: <strong>{fmtKRW(totalValue)}</strong></span>
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

      {/* 이력 — 모바일 카드 */}
      {history.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">이력이 없습니다.</p>
      ) : (
        <>
          {/* 모바일 카드 리스트 */}
          <div className="md:hidden space-y-2 px-1">
            {history.map(rec => {
              const ret = calcReturn(rec.total_value, rec.acquisition_cost)
              const isAvail = rec.available === '가용'
              return (
                <div key={rec.id}
                  className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
                  {/* 상단: 날짜 + 가용배지 + 평가금액 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">{rec.date}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isAvail
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {rec.available}
                      </span>
                    </div>
                    <span className="text-base font-bold text-gray-900 dark:text-slate-100 tabular-nums">
                      {fmtKRW(rec.total_value)}
                    </span>
                  </div>
                  {/* 중간: 메타 그리드 */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="text-gray-400 dark:text-slate-400">주수</div>
                    <div className="text-gray-700 dark:text-slate-200 tabular-nums text-right">{rec.shares.toLocaleString()}주</div>
                    <div className="text-gray-400 dark:text-slate-400">주가</div>
                    <div className="text-gray-700 dark:text-slate-200 tabular-nums text-right">{rec.price.toLocaleString()}원</div>
                    <div className="text-gray-400 dark:text-slate-400">취득가액</div>
                    <div className="text-gray-700 dark:text-slate-200 tabular-nums text-right">
                      {rec.acquisition_cost ? fmtKRW(rec.acquisition_cost) : '-'}
                    </div>
                    <div className="text-gray-400 dark:text-slate-400">수익률</div>
                    <div className="text-right">
                      {ret !== null
                        ? <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span>
                        : <span className="text-gray-300 dark:text-slate-500">-</span>}
                    </div>
                  </div>
                  {/* 액션 버튼 */}
                  {isEditable && (
                    <div className="flex gap-2 pt-1 border-t border-gray-100 dark:border-slate-700">
                      <button onClick={() => loadRecord(rec)}
                        className="flex-1 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30">
                        수정
                      </button>
                      <button onClick={() => handleRemove(rec.id)}
                        className="flex-1 py-1.5 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* PC 테이블 (NotionTable) */}
          <div className="hidden md:block">
            {(() => {
              const columns: ColumnDef<EquityRecord, unknown>[] = [
                { accessorKey: 'date', header: '기준일' },
                {
                  accessorKey: 'shares',
                  header: '주수',
                  cell: ({ getValue }) => (
                    <span className="tabular-nums text-gray-600 dark:text-slate-100">{getValue<number>().toLocaleString()}</span>
                  ),
                },
                {
                  accessorKey: 'price',
                  header: '주가',
                  cell: ({ getValue }) => (
                    <span className="tabular-nums text-gray-600 dark:text-slate-100">{getValue<number>().toLocaleString()}원</span>
                  ),
                },
                {
                  accessorKey: 'total_value',
                  header: '평가금액',
                  cell: ({ getValue }) => (
                    <span className="tabular-nums font-medium text-gray-800 dark:text-slate-100">{fmtKRW(getValue<number>())}</span>
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
                      : <span className="text-gray-300 dark:text-slate-500">-</span>
                  },
                },
                {
                  accessorKey: 'acquisition_cost',
                  header: '취득가액',
                  cell: ({ getValue }) => {
                    const v = getValue<number>()
                    return <span className="tabular-nums text-gray-400 dark:text-slate-300">{v ? fmtKRW(v) : '-'}</span>
                  },
                },
                {
                  accessorKey: 'available',
                  header: '가용',
                  cell: ({ getValue }) => {
                    const v = getValue<string>()
                    return (
                      <span className={`px-1 rounded ${v === '가용' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-300'}`}>
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
        </>
      )}
    </div>
  )
}


