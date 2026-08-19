import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { getCompanyNames } from '../hooks/useCompanies'
import { fmtKRW, fmtNumber } from '../lib/format'
import { CompleteTradeModal } from '../components/fx/CompleteTradeModal'
import { orderTypeLabel } from '../lib/fxOrderType'
import type { Company, FxTradeRecord, FxTradeFill, FxLotConsumption } from '../types'

const FX_CODES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const STATUS_LIST = ['발의', '승인', '부분체결', '완료', '취소']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

function pnlColor(v: number | null) {
  if (v == null) return 'text-gray-400 dark:text-slate-500'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    '발의':   'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
    '승인':   'bg-blue-100   dark:bg-blue-900/40   text-blue-700   dark:text-blue-300',
    '부분체결': 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    '완료':   'bg-green-100  dark:bg-green-900/40  text-green-700  dark:text-green-300',
    '취소':   'bg-gray-100   dark:bg-slate-700      text-gray-500   dark:text-slate-400',
  }
  return map[s] ?? map['취소']
}

// 체결 내역 펼쳐보기 — 체결(fill)마다 소진된 FIFO 로트 상세(장부환율)까지 표시
function FillDetailRows({ trade, fetchTradeDetail, refreshKey, canReverse, onRequestReverse }: {
  trade: FxTradeRecord
  fetchTradeDetail: (tradeId: string) => Promise<{ fills: FxTradeFill[]; consumptionsByFillId: Record<string, FxLotConsumption[]> }>
  refreshKey: number
  canReverse: boolean
  onRequestReverse: (fill: FxTradeFill) => void
}) {
  const [loading, setLoading] = useState(true)
  const [fills, setFills] = useState<FxTradeFill[]>([])
  const [consumptionsByFillId, setConsumptionsByFillId] = useState<Record<string, FxLotConsumption[]>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const detail = await fetchTradeDetail(trade.id)
      if (!cancelled) {
        setFills(detail.fills)
        setConsumptionsByFillId(detail.consumptionsByFillId)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [trade.id, fetchTradeDetail, refreshKey])

  return (
    <tr>
      <td colSpan={13} className="bg-gray-50 dark:bg-slate-900/60 pl-28 pr-6 py-4">
        {loading ? (
          <p className="text-xs text-gray-400">체결 내역 불러오는 중…</p>
        ) : fills.length === 0 ? (
          <p className="text-xs text-gray-400">아직 등록된 체결이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {fills.map((f, i) => {
              const consumptions = consumptionsByFillId[f.id] ?? []
              return (
                <div key={f.id} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                        {i + 1}차 체결
                      </span>
                      <span className="text-gray-600 dark:text-slate-300">{f.fill_date}</span>
                      {f.completed_by && <span className="text-gray-400">· {f.completed_by}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <span className="text-gray-700 dark:text-slate-200 font-medium">
                        {fmtNumber(f.amount_fx, f.currency === 'JPY' ? 0 : 2)} {f.currency} @ {fmtNumber(f.completed_rate, 2)}
                      </span>
                      <span className={`font-semibold ${pnlColor(f.realized_pnl)}`}>
                        {f.realized_pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(f.realized_pnl))}
                      </span>
                      {canReverse && (
                        <button onClick={() => onRequestReverse(f)}
                          className="text-[11px] px-2 py-0.5 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30">
                          이 체결만 취소
                        </button>
                      )}
                    </div>
                  </div>
                  {consumptions.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 dark:text-slate-500">
                          <th className="text-left font-medium px-3 py-1.5">소진 로트</th>
                          <th className="text-right font-medium px-3 py-1.5">소진 수량</th>
                          <th className="text-right font-medium px-3 py-1.5">장부환율</th>
                          <th className="text-right font-medium px-3 py-1.5">처분환율</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {consumptions.map((c, j) => (
                          <tr key={c.id}>
                            <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400">로트 {j + 1}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-slate-300">
                              {fmtNumber(c.amount, f.currency === 'JPY' ? 0 : 2)} {f.currency}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtNumber(c.acq_rate, 2)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtNumber(c.disposal_rate, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </td>
    </tr>
  )
}

export default function FxTradeHistoryPage() {
  const { user, canEdit, canApprove, canDelete, canAction } = useAuth()
  // 외화매매거래 작업 권한 — 역할 기본값 위에 사용자별 개별 부여/회수 가능 (UsersPage > 작업 권한)
  // 승인·완료·취소 모두 레코드를 변경하므로 write 로 통일해 게이트한다.
  const canWriteFxTrade = canAction('fx_trade', 'write')
  const { company: resolvedCompany } = usePageCompany()
  const hist = useFxTradeHistory()

  const companies = getCompanyNames()

  // 필터 상태
  const [filterCompany, setFilterCompany] = useState<string>(resolvedCompany ?? '전체')
  const [filterFrom,    setFilterFrom]    = useState(monthAgoStr())
  const [filterTo,      setFilterTo]      = useState(todayStr())
  const [filterCcy,     setFilterCcy]     = useState('전체')
  const [filterStatus,  setFilterStatus]  = useState('전체')

  // 체결 등록 모달
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)
  // 체결 내역 펼쳐보기
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 삭제 확인 패널 — window.confirm 은 크롬이 반복 대화상자를 차단하면 조용히
  // 취소로 처리돼 "눌러도 안 지워지는" 상태가 된다(세션24차 실사고). 화면 안에서
  // 확인받는다. '완료'/'부분체결' 건은 FIFO 소진 이력이 있어 삭제 대신 먼저
  // "취소"(원복)로 되돌린 뒤에만 삭제 가능하다.
  const [deleteTarget, setDeleteTarget] = useState<FxTradeRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  // 개별 체결 1건 취소 확인 패널 (동일 원칙 — window.confirm 미사용)
  const [reverseFillTarget, setReverseFillTarget] = useState<{ trade: FxTradeRecord; fill: FxTradeFill } | null>(null)
  const [reversingFill, setReversingFill] = useState(false)
  const [fillDetailRefreshKey, setFillDetailRefreshKey] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  const doFetch = useCallback(() => {
    hist.fetch({
      company: filterCompany !== '전체' ? filterCompany as Company : undefined,
      from:    filterFrom || undefined,
      to:      filterTo   || undefined,
      currency: filterCcy,
      status:   filterStatus,
    })
  }, [filterCompany, filterFrom, filterTo, filterCcy, filterStatus]) // eslint-disable-line

  useEffect(() => { doFetch() }, []) // 초기 조회

  // 요약 통계
  const summary = useMemo(() => {
    const rows = hist.data
    const totalKrw = rows.filter(r => r.status !== '취소').reduce((s, r) => s + (r.amount_krw ?? 0), 0)
    const totalPnl = rows.filter(r => r.status === '완료' || r.status === '부분체결').reduce((s, r) => s + (r.completed_pnl ?? r.fx_pnl ?? 0), 0)
    const byStatus = { 발의: 0, 승인: 0, 부분체결: 0, 완료: 0, 취소: 0 } as Record<string, number>
    rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1 })
    return { count: rows.length, totalKrw, totalPnl, byStatus }
  }, [hist.data])

  // CSV 다운로드
  function downloadCsv() {
    const headers = ['집행일', '법인', '구분', '통화', '외화금액', '취득환율', '매도예정환율', '예상환차손익',
                     '실체결환율(가중평균)', '확정 환차손익(누적)', '체결수량(누적)', '원화금액', '상태', '발의자', '승인자', '완료자', '메모']
    const rows = hist.data.map(r => [
      r.trade_date, r.company, r.direction === 'sell' ? '매도' : '매수', r.currency,
      r.amount_fx, r.acq_rate ?? '', r.trade_rate ?? '', r.fx_pnl ?? '',
      r.completed_rate ?? '', r.completed_pnl ?? '', r.filled_amount ?? 0,
      r.amount_krw ?? '', r.status,
      r.created_by ?? '', r.approved_by ?? '', r.completed_by ?? '', r.memo ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fx_trade_history_${filterFrom}_${filterTo}.csv`
    a.click()
  }

  async function handleApprove(id: string) {
    if (!window.confirm('이 발의를 승인하시겠습니까?')) return
    await hist.approve(id, user?.label ?? '')
    doFetch()
  }

  async function handleCancel(id: string) {
    if (!window.confirm('이 발의를 취소하시겠습니까? 체결이 있었다면 전부 원복됩니다.')) return
    await hist.cancel(id, user?.label ?? '')
    doFetch()
  }

  async function handleReverseFill() {
    if (!reverseFillTarget) return
    setReversingFill(true)
    setMessage(null)
    try {
      const { error } = await hist.reverseFill(reverseFillTarget.fill.id, user?.label ?? '')
      if (error) { setMessage(error.message ?? String(error)); return }
      setReverseFillTarget(null)
      setFillDetailRefreshKey(k => k + 1)
      doFetch()
    } finally {
      setReversingFill(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await hist.remove(deleteTarget.id)
      setDeleteTarget(null)
      doFetch()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          {message}
        </div>
      )}
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">💱 외화매매거래 이력</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">FX 매도 발의 → 승인 → (부분)체결 → 완료 누적 이력</p>
        </div>
        <button onClick={downloadCsv}
          className="text-sm px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-300
                     hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5">
          📥 CSV 다운로드
        </button>
      </div>

      {/* 검색 필터 */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">법인</div>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {companies.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">기간 시작</div>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
          <span className="text-gray-400 pb-1.5">~</span>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">기간 종료</div>
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">통화</div>
            <select value={filterCcy} onChange={e => setFilterCcy(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {FX_CODES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">상태</div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={doFetch}
            className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
            조회
          </button>
        </div>
      </div>

      {/* 요약 칩 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '조회 건수',       value: `${summary.count}건`, color: 'text-gray-900 dark:text-slate-100' },
          { label: '총 매도금액(원화)', value: fmtKRW(summary.totalKrw), color: 'text-gray-900 dark:text-slate-100' },
          { label: '누적 환차손익(체결분)', value: summary.totalPnl === 0 ? '—' : `${summary.totalPnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(summary.totalPnl))}`,
            color: summary.totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400' },
          { label: '발의/승인/부분체결/완료/취소',
            value: `${summary.byStatus['발의']??0}/${summary.byStatus['승인']??0}/${summary.byStatus['부분체결']??0}/${summary.byStatus['완료']??0}/${summary.byStatus['취소']??0}`,
            color: 'text-gray-900 dark:text-slate-100' },
        ].map(chip => (
          <div key={chip.label} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{chip.label}</p>
            <p className={`text-base font-bold tabular-nums ${chip.color}`}>{chip.value}</p>
          </div>
        ))}
      </div>

      {/* 이력 테이블 */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {hist.loading ? (
          <div className="text-center py-12 text-sm text-gray-400 dark:text-slate-500">불러오는 중…</div>
        ) : hist.data.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400 dark:text-slate-500">조회된 이력이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                  {['', '집행일', '법인', '구분', '통화', '외화금액', '취득환율', '매도환율', '예상 환차손익',
                    '실체결환율', '확정 환차손익', '잔여', '상태', '발의자', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-sky-300 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {hist.data.map(r => {
                  const remaining = Math.max(0, r.amount_fx - (r.filled_amount ?? 0))
                  const hasFills = (r.filled_amount ?? 0) > 0
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                        <td className="px-2 py-2.5">
                          {hasFills && (
                            <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
                              title="체결 내역 보기">
                              {expandedId === r.id ? '▾' : '▸'}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-gray-700 dark:text-slate-300">{r.trade_date}</td>
                        <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300 whitespace-nowrap">{r.company}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            r.direction === 'sell'
                              ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          }`}>
                            {r.direction === 'sell' ? '매도' : '매수'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-slate-200">{r.currency}</td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-gray-700 dark:text-slate-300 whitespace-nowrap">
                          {fmtNumber(r.amount_fx, r.currency === 'JPY' ? 0 : 2)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {r.acq_rate != null ? fmtNumber(r.acq_rate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {r.trade_rate != null ? fmtNumber(r.trade_rate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className={`px-3 py-2.5 tabular-nums text-right whitespace-nowrap font-medium ${pnlColor(r.fx_pnl)}`}>
                          {r.fx_pnl != null
                            ? `${r.fx_pnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(r.fx_pnl))}`
                            : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {r.completed_rate != null ? fmtNumber(r.completed_rate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className={`px-3 py-2.5 tabular-nums text-right whitespace-nowrap font-medium ${pnlColor(r.completed_pnl)}`}>
                          {r.completed_pnl != null
                            ? `${r.completed_pnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(r.completed_pnl))}`
                            : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {r.status === '부분체결' ? fmtNumber(remaining, r.currency === 'JPY' ? 0 : 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">{r.created_by ?? ''}</td>
                        {/* 액션 */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex gap-1">
                            {r.status === '발의' && canApprove() && canWriteFxTrade && (
                              <button onClick={() => handleApprove(r.id)}
                                className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                                승인
                              </button>
                            )}
                            {(r.status === '승인' || r.status === '부분체결') && canEdit() && canWriteFxTrade && (
                              <button onClick={() => setCompleteTarget(r.id)}
                                className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                                체결 등록
                              </button>
                            )}
                            {(r.status === '발의' || r.status === '승인' || r.status === '부분체결' || r.status === '완료') && canApprove() && canWriteFxTrade && (
                              <button onClick={() => handleCancel(r.id)}
                                className="text-xs px-2.5 py-1 border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                                취소
                              </button>
                            )}
                            {(r.status === '발의' || r.status === '취소') && canDelete() && (
                              <button onClick={() => setDeleteTarget(r)}
                                className="text-xs px-2.5 py-1 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30">
                                삭제
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <FillDetailRows trade={r} fetchTradeDetail={hist.fetchTradeDetail}
                          refreshKey={fillDetailRefreshKey}
                          canReverse={canApprove() && canWriteFxTrade}
                          onRequestReverse={fill => setReverseFillTarget({ trade: r, fill })} />
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 체결 등록 모달 */}
      {completeTarget && (() => {
        const rec = hist.data.find(r => r.id === completeTarget)
        if (!rec) return null
        return (
          <CompleteTradeModal
            record={rec}
            onClose={() => setCompleteTarget(null)}
            onSubmit={async (amount, rate, fillDate) => {
              const { error } = await hist.fillTrade(rec.id, amount, rate, fillDate, user?.label ?? '')
              if (error) return error.message ?? String(error)
              doFetch()
              return null
            }}
          />
        )
      })()}

      {/* 삭제 확인 패널 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
              <p className="text-base font-semibold text-gray-800 dark:text-slate-100">🗑 매각 지시 삭제</p>
              <p className="text-xs text-gray-400 mt-0.5">복구할 수 없습니다. 삭제할 항목을 확인하세요.</p>
            </div>
            <div className="px-6 py-4 space-y-1.5 text-xs text-gray-600 dark:text-slate-300">
              <p>{deleteTarget.company} · {deleteTarget.currency} {deleteTarget.amount_fx.toLocaleString()}</p>
              <p>{deleteTarget.trade_date} 등록 · 상태 {deleteTarget.status} · {orderTypeLabel(deleteTarget.order_type)}</p>
              {deleteTarget.memo && <p className="text-gray-400">{deleteTarget.memo}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                취소
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
                {deleting ? '삭제 중...' : '삭제 실행'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 개별 체결 취소 확인 패널 */}
      {reverseFillTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setReverseFillTarget(null) }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
              <p className="text-base font-semibold text-gray-800 dark:text-slate-100">↩ 이 체결만 취소</p>
              <p className="text-xs text-gray-400 mt-0.5">이 체결이 소진한 FIFO 로트만 복원됩니다. 다른 체결은 유지됩니다.</p>
            </div>
            <div className="px-6 py-4 space-y-1.5 text-xs text-gray-600 dark:text-slate-300">
              <p>{reverseFillTarget.trade.company} · {reverseFillTarget.trade.currency} {reverseFillTarget.trade.amount_fx.toLocaleString()} 지시 중</p>
              <p>
                {reverseFillTarget.fill.fill_date} 체결 · {fmtNumber(reverseFillTarget.fill.amount_fx, reverseFillTarget.fill.currency === 'JPY' ? 0 : 2)} {reverseFillTarget.fill.currency}
                {' '}@ {fmtNumber(reverseFillTarget.fill.completed_rate, 2)}
              </p>
              <p className={pnlColor(reverseFillTarget.fill.realized_pnl)}>
                손익 {reverseFillTarget.fill.realized_pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(reverseFillTarget.fill.realized_pnl))}
              </p>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setReverseFillTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                닫기
              </button>
              <button onClick={handleReverseFill} disabled={reversingFill}
                className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
                {reversingFill ? '취소 중...' : '이 체결 취소 실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
