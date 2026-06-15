import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue } from '../../lib/format'
import { fetchBondPrice } from '../../hooks/useGas'
import type { InvestmentRecord } from '../../types'
import { NotionTable, type ColumnDef } from '../common/NotionTable'

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

// 정수 필드 천단위 포맷 헬퍼
function fmtInt(val: string): string {
  const n = val.replace(/[^0-9]/g, '')
  return n ? Number(n).toLocaleString() : ''
}
function parseIntStr(val: string): number {
  return Number(val.replace(/[^0-9]/g, '')) || 0
}
// 소수점 허용 천단위 포맷 (기준가용)
function fmtDecimal(val: string): string {
  const clean = val.replace(/[^0-9.]/g, '')
  const dotIdx = clean.indexOf('.')
  if (dotIdx === -1) return clean ? Number(clean).toLocaleString() : ''
  const intPart = clean.slice(0, dotIdx)
  const decPart = clean.slice(dotIdx + 1).replace(/\./g, '')
  return `${intPart ? Number(intPart).toLocaleString() : '0'}.${decPart}`
}
function parseDecimalStr(val: string): number {
  return Number(val.replace(/,/g, '')) || 0
}

const EMPTY = {
  priceDate: new Date().toISOString().slice(0, 10),
  bondQty: '',
  bondPrice: '',
  acquisition_cost: '',
  available: '가용' as '가용' | '불가용',
}

function prefillFromHistory(history: InvestmentRecord[]) {
  if (!history.length) return { ...EMPTY }
  const latest = history.reduce((best, r) =>
    (r.priceDate ?? r.start ?? '') > (best.priceDate ?? best.start ?? '') ? r : best
  )
  return {
    priceDate: new Date().toISOString().slice(0, 10),
    bondQty:          latest.bondQty          ? Number(latest.bondQty).toLocaleString()          : '',
    bondPrice:        '',
    acquisition_cost: latest.acquisition_cost > 0 ? Number(latest.acquisition_cost).toLocaleString() : '',
    available:        latest.available ?? '가용' as '가용' | '불가용',
  }
}

export default function BondHistoryPanel({
  bondName, isin, company, history, onSave, onRemove, onBulkAcq, isEditable,
}: Props) {
  const [form, setForm]     = useState(() => prefillFromHistory(history))
  const [editId, setEditId] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const evalAmt  = calcBondValue(parseIntStr(form.bondQty), parseDecimalStr(form.bondPrice))
  const retPreview = calcReturn(evalAmt, parseIntStr(form.acquisition_cost))

  function loadRecord(rec: InvestmentRecord) {
    setEditId(rec.id)
    setForm({
      priceDate:        rec.priceDate || rec.maturity || '',
      bondQty:          rec.bondQty          ? Number(rec.bondQty).toLocaleString()          : '',
      bondPrice:        rec.bondPrice        ? fmtDecimal(String(rec.bondPrice))             : '',
      acquisition_cost: rec.acquisition_cost ? Number(rec.acquisition_cost).toLocaleString() : '',
      available:        rec.available,
    })
  }

  function resetForm() {
    setEditId(null)
    setForm(prefillFromHistory(history))
    setError(null)
  }

  async function handleFetchPrice() {
    if (!isin) return
    setFetching(true)
    setError(null)
    try {
      // 기준일을 YYYYMMDD 형식으로 전달 → 해당 날짜의 기준가 조회
      const basDt = form.priceDate.replace(/-/g, '')
      const res = await fetchBondPrice(isin, basDt)
      // 기준가만 업데이트, 기준일은 사용자가 선택한 날짜 유지
      setForm(f => ({ ...f, bondPrice: fmtDecimal(String(res.price)) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : `기준가 없음 — 해당 날짜(${form.priceDate})는 공휴일·주말이거나 아직 집계 전(T+1)입니다`)
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company) return
    setSaving(true)
    setError(null)

    const qty   = parseIntStr(form.bondQty)
    const price = parseDecimalStr(form.bondPrice)
    const acq   = parseIntStr(form.acquisition_cost)

    // 동일 기준일 기존 레코드 → update(upsert), 없으면 insert
    const existingByDate = history.find(h => (h.priceDate ?? h.start ?? '') === form.priceDate)
    const saveId = editId ?? existingByDate?.id

    const record = {
      ...(saveId ? { id: saveId } : {}),
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

    // 취득가액이 있고, 신규 insert이고, 기존 이력 중 다른 취득가액이 있는 경우만 일괄반영 팝업
    const isNewInsert = !saveId
    const hasAcqMismatch = history.some(h => h.acquisition_cost !== acq)
    if (acq > 0 && isNewInsert && hasAcqMismatch) {
      const ids = history.map(h => h.id)
      if (ids.length > 0 && confirm(`"${bondName}" 취득가액(${acq.toLocaleString()}원)을 전체 이력에 반영하시겠습니까?`)) {
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
    <div className="bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700 p-4 space-y-4">

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
              <input type="date" value={form.priceDate}
                onChange={e => setForm(f => ({ ...f, priceDate: e.target.value }))}
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">보유 좌수</label>
              <input type="text" inputMode="numeric" value={form.bondQty}
                onChange={e => setForm(f => ({ ...f, bondQty: fmtInt(e.target.value) }))}
                placeholder="0"
                className="w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs text-right bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">
                기준가 (÷10=1좌당)
                {fetching && <span className="ml-1 text-blue-400 animate-pulse">조회 중…</span>}
              </label>
              <div className="flex gap-1">
                <input type="text" inputMode="decimal" value={form.bondPrice}
                  onChange={e => setForm(f => ({ ...f, bondPrice: fmtDecimal(e.target.value) }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs text-right bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button type="button" onClick={handleFetchPrice} disabled={fetching}
                  title="전 영업일 기준가 조회 (공공데이터 T+1)"
                  className="shrink-0 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 whitespace-nowrap">
                  {fetching ? '조회 중' : '조회'}
                </button>
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

          <div>
            <label className="block text-xs text-gray-400 dark:text-gray-500 mb-1">가용 여부</label>
            <select value={form.available}
              onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
              className="border border-gray-200 dark:border-slate-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="가용">가용</option>
              <option value="불가용">불가용</option>
            </select>
          </div>

          {evalAmt > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500 dark:text-slate-300">평가금액: <strong>{fmtKRW(evalAmt)}</strong></span>
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

      {(() => {
        const columns: ColumnDef<InvestmentRecord, unknown>[] = [
          {
            id: 'priceDate',
            header: '기준일',
            accessorFn: row => row.priceDate || row.start,
          },
          {
            accessorKey: 'bondQty',
            header: '좌수',
            cell: ({ getValue }) => (
              <span className="tabular-nums text-gray-600 dark:text-slate-100">{(getValue<number | undefined>() || 0).toLocaleString()}</span>
            ),
          },
          {
            accessorKey: 'bondPrice',
            header: '기준가',
            cell: ({ getValue }) => (
              <span className="tabular-nums text-gray-600 dark:text-slate-100">{getValue<number | undefined>() ?? '-'}</span>
            ),
          },
          {
            id: 'evalAmt',
            header: '평가금액',
            accessorFn: row =>
              row.bondQty && row.bondPrice ? calcBondValue(row.bondQty, row.bondPrice) : row.amount,
            cell: ({ getValue }) => (
              <span className="tabular-nums font-medium text-gray-800">{fmtKRW(getValue<number>())}</span>
            ),
          },
          {
            id: 'return',
            header: '수익률',
            accessorFn: row => {
              const val = row.bondQty && row.bondPrice ? calcBondValue(row.bondQty, row.bondPrice) : row.amount
              return calcReturn(val, row.acquisition_cost) ?? -Infinity
            },
            cell: ({ row }) => {
              const val = row.original.bondQty && row.original.bondPrice
                ? calcBondValue(row.original.bondQty, row.original.bondPrice)
                : row.original.amount
              const ret = calcReturn(val, row.original.acquisition_cost)
              return ret !== null
                ? <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span>
                : <span className="text-gray-300">-</span>
            },
          },
          {
            accessorKey: 'acquisition_cost',
            header: '취득가액',
            cell: ({ getValue }) => {
              const v = getValue<number | undefined>()
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
            cell: ({ row }: { row: { original: InvestmentRecord } }) => (
              <div className="flex gap-1.5">
                <button onClick={() => loadRecord(row.original)} className="text-blue-400 hover:text-blue-600">수정</button>
                <button onClick={() => handleRemove(row.original.id)} className="text-red-300 hover:text-red-500">삭제</button>
              </div>
            ),
          } as ColumnDef<InvestmentRecord, unknown>] : []),
        ]
        return (
          <NotionTable<InvestmentRecord>
            tableId="bond_history"
            columns={columns}
            data={history}
            emptyText="이력이 없습니다."
          />
        )
      })()}
    </div>
  )
}


