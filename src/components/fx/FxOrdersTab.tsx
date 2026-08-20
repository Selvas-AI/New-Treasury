import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useFxTradeHistory } from '../../hooks/useFxTradeHistory'
import { getCompanyNames } from '../../hooks/useCompanies'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { CompleteTradeModal } from './CompleteTradeModal'
import FxOrderProposeModal from './FxOrderProposeModal'
import { FillConsumptionCard } from './FillConsumptionDetail'
import { orderTypeLabel } from '../../lib/fxOrderType'
import { addBizDays, bizDaysBetween, todayStr } from '../../lib/bizDay'
import type { Company, FxTradeRecord, FxTradeFill, FxLotConsumption } from '../../types'

const FX_CODES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const STATUS_LIST = ['발의', '승인', '부분체결', '완료', '취소']
const PENDING_STATUS = ['발의', '승인', '부분체결']

function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
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

function pnlColor(v: number | null) {
  if (v == null) return 'text-gray-400 dark:text-slate-500'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
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
            {fills.map((f, i) => (
              <FillConsumptionCard key={f.id} fill={f} index={i}
                consumptions={consumptionsByFillId[f.id] ?? []}
                canReverse={canReverse} onRequestReverse={onRequestReverse} />
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}

/**
 * ② 매각 지시 관리 탭 — 외화매매거래 발의→승인→(부분)체결→완료 워크플로우.
 *
 * 세션26차 4일차: 옛 FxTradeHistoryPage.tsx 를 외화 원장(FxLedgerPage) 안의 탭으로 이관.
 * 재고(FIFO 로트)와 체결 워크플로우가 메뉴만 분리돼 있던 것을 하나의 페이지·데이터 흐름으로
 * 통합하기 위함 — 여기서 체결을 등록하면 `onChanged()` 를 통해 원장 탭의 잔액도 즉시 갱신된다.
 *
 * 이 탭은 감사·오디트 목적의 자유 필터(법인/기간/통화/상태 전체)를 그대로 유지한다 —
 * 원장 탭·로트 설정 탭과 달리 선택된 법인+통화에 국한하지 않는다.
 */
export function FxOrdersTab({ company, currency, pendingOrders, initialOrderId, onChanged }: {
  company: Company
  currency: string
  /**
   * 법인 단위 **미완료(발의/승인/부분체결) 매각 지시 전량**. 페이지가 A패턴 훅
   * (`useFxTradeHistory(company)`, 기간·통화 필터 없음)에서 넘겨준다.
   *
   * ⚠ 이 탭 자체의 조회 결과(`hist.data`)로 대체하지 말 것 —
   *   `trade_date` 는 **희망 집행일(미래)** 이라 "기간 종료 = 오늘" 필터에 걸려
   *   방금 발의한 지시가 목록에서 통째로 빠진다. 실제로 자금정책에서 "체결 등록 →"
   *   으로 넘어와도 체결할 대상이 안 보이는 사고가 있었다(2026-08-20 리포트).
   *   이행해야 할 일은 조회 조건과 무관하게 항상 보여야 한다.
   */
  pendingOrders: FxTradeRecord[]
  /** 딥링크(`?order=`)로 지목된 지시 — 해당 카드를 강조하고 체결 모달을 자동으로 연다. */
  initialOrderId?: string | null
  onChanged: () => void
}) {
  const { user, canEdit, canApprove, canDelete, canAction } = useAuth()
  const canWriteFxTrade = canAction('fx_trade', 'write')
  const hist = useFxTradeHistory()

  const companies = getCompanyNames()

  const [filterCompany, setFilterCompany] = useState<string>(company)
  const [filterFrom,    setFilterFrom]    = useState(monthAgoStr())
  // 기간 종료 기본값이 "오늘"이면 안 된다 — trade_date 는 희망 집행일이라 발의 직후에는
  // 대개 미래(+3영업일)다. 넉넉히 미래까지 포함해야 방금 만든 지시가 목록에 보인다.
  const [filterTo,      setFilterTo]      = useState(addBizDays(todayStr(), 10))
  const [filterCcy,     setFilterCcy]     = useState(currency)
  const [filterStatus,  setFilterStatus]  = useState('전체')

  const [completeTarget, setCompleteTarget] = useState<string | null>(null)
  const [proposeOpen, setProposeOpen] = useState(false)
  // 승인·취소 확인은 화면 안 패널로 받는다 — window.confirm 은 크롬이 반복 대화상자를
  // 차단하면 즉시 false 를 반환해 "눌러도 아무 일 없는" 상태가 된다(세션24차 실사고).
  const [approveTarget, setApproveTarget] = useState<FxTradeRecord | null>(null)
  const [approving, setApproving] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<FxTradeRecord | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FxTradeRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
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

  // 딥링크로 지목된 지시가 체결 가능한 상태면 모달을 바로 연다(자금정책 "체결 등록 →" 등).
  const [handledInitial, setHandledInitial] = useState(false)
  useEffect(() => {
    if (handledInitial || !initialOrderId) return
    const target = pendingOrders.find(o => o.id === initialOrderId)
    if (!target) return
    setHandledInitial(true)
    if (target.status === '승인' || target.status === '부분체결') setCompleteTarget(target.id)
  }, [initialOrderId, pendingOrders, handledInitial])

  // 이행 대기 목록 — 조회 필터와 무관하게 항상 표시. 통화 탭(선택 통화)을 먼저 보여주되
  // 다른 통화의 대기 건도 숨기지 않는다(놓치면 기한 초과로 이어지므로).
  const pendingSorted = useMemo(() => [...pendingOrders]
    .filter(o => o.direction === 'sell' && PENDING_STATUS.includes(o.status))
    .sort((a, b) => (a.currency === currency ? -1 : b.currency === currency ? 1 : 0)
      || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [pendingOrders, currency])

  const summary = useMemo(() => {
    const rows = hist.data
    const totalKrw = rows.filter(r => r.status !== '취소').reduce((s, r) => s + (r.amount_krw ?? 0), 0)
    const totalPnl = rows.filter(r => r.status === '완료' || r.status === '부분체결').reduce((s, r) => s + (r.completed_pnl ?? r.fx_pnl ?? 0), 0)
    const byStatus = { 발의: 0, 승인: 0, 부분체결: 0, 완료: 0, 취소: 0 } as Record<string, number>
    rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1 })
    return { count: rows.length, totalKrw, totalPnl, byStatus }
  }, [hist.data])

  function downloadCsv() {
    const headers = ['매도발의일(집행일)', '법인', '구분', '통화', '외화금액', '취득환율', '매도예정환율', '예상환차손익',
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

  /** 승인 확정. thenFill=true 면 곧바로 체결 등록 모달로 이어진다(1인 담당 법인 편의). */
  async function handleApprove(thenFill: boolean) {
    if (!approveTarget) return
    const id = approveTarget.id
    setApproving(true)
    try {
      await hist.approve(id, user?.label ?? '')
      setApproveTarget(null)
      doFetch(); onChanged()
      if (thenFill) setCompleteTarget(id)
    } finally {
      setApproving(false)
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await hist.cancel(cancelTarget.id, user?.label ?? '')
      setCancelTarget(null)
      doFetch(); onChanged()
    } finally {
      setCancelling(false)
    }
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
      doFetch(); onChanged()
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
      doFetch(); onChanged()
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-400">FX 매도 발의 → 승인 → (부분)체결 → 완료 누적 이력. 체결 등록 시 원장 탭 잔액에 즉시 반영됩니다.</p>
        <div className="flex gap-2">
          {canEdit() && canWriteFxTrade && (
            <button onClick={() => setProposeOpen(true)}
              className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
              ➕ 매각 지시 등록
            </button>
          )}
          <button onClick={downloadCsv}
            className="text-sm px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-300
                       hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5">
            📥 CSV 다운로드
          </button>
        </div>
      </div>

      {/* ⏳ 이행 대기 지시 — 조회 필터와 무관하게 항상 상단 고정.
          발의(자금정책/리짐/실무)는 여러 경로지만 실행은 여기 한 곳이므로, 넘어온 사람이
          바로 승인·체결할 수 있어야 한다("발의는 여러 곳, 집행·추적은 한 곳"). */}
      {pendingSorted.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              ⏳ 이행 대기 매각 지시 {pendingSorted.length}건
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">등록일+3영업일 내, 환율과 무관하게 실행</p>
          </div>
          <div className="space-y-1.5">
            {pendingSorted.map(o => {
              const dday = o.due_date ? bizDaysBetween(todayStr(), o.due_date) : null
              const filled = o.filled_amount ?? 0
              const remaining = Math.max(0, o.amount_fx - filled)
              const highlight = o.id === initialOrderId
              return (
                <div key={o.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                    highlight ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-300'
                              : 'border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-800'}`}>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadge(o.status)}`}>{o.status}</span>
                    {dday != null && (
                      <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded ${
                        dday < 0 ? 'bg-red-600 text-white' : dday === 0 ? 'bg-amber-500 text-white'
                                 : 'bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-slate-200'}`}>
                        {dday < 0 ? `기한초과 D+${Math.abs(dday)}` : dday === 0 ? 'D-day' : `D-${dday}`}
                      </span>
                    )}
                    <span className="text-gray-400 shrink-0">{orderTypeLabel(o.order_type)}</span>
                    <span className="font-medium text-gray-800 dark:text-slate-100 tabular-nums">
                      {o.currency} {fmtNumber(o.amount_fx, o.currency === 'JPY' ? 0 : 2)}
                      {filled > 0 && (
                        <span className="ml-1 font-normal text-purple-600 dark:text-purple-400">
                          (체결 {fmtNumber(filled, o.currency === 'JPY' ? 0 : 2)} · 잔여 {fmtNumber(remaining, o.currency === 'JPY' ? 0 : 2)})
                        </span>
                      )}
                    </span>
                    <span className="text-gray-400">기한 {o.due_date ?? '—'}</span>
                  </div>
                  <div className="shrink-0 flex gap-1">
                    {o.status === '발의' && canApprove() && canWriteFxTrade && (
                      <button onClick={() => setApproveTarget(o)}
                        className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">승인</button>
                    )}
                    {(o.status === '승인' || o.status === '부분체결') && canEdit() && canWriteFxTrade && (
                      <button onClick={() => setCompleteTarget(o.id)}
                        className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium">체결 등록</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {pendingSorted.some(o => o.status === '발의') && !canApprove() && (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              승인 권한이 없어 체결을 진행할 수 없습니다 — 승인권자에게 요청하세요.
            </p>
          )}
        </div>
      )}

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
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">발의일 시작</div>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
          <span className="text-gray-400 pb-1.5">~</span>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">발의일 종료</div>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '조회 건수',       value: `${summary.count}건`, color: 'text-gray-900 dark:text-slate-100' },
          { label: '총 매도금액(원화)', value: fmtKRW(summary.totalKrw), color: 'text-gray-900 dark:text-slate-100' },
          { label: '누적 환차손익(체결분)', value: summary.totalPnl === 0 ? '—' : `${summary.totalPnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(summary.totalPnl))}`,
            color: summary.totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400' },
        ].map(chip => (
          <div key={chip.label} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{chip.label}</p>
            <p className={`text-base font-bold tabular-nums ${chip.color}`}>{chip.value}</p>
          </div>
        ))}
        {/* 상태별 건수 — 과거엔 "0/0/0/9/0" 한 줄이라 어느 숫자가 무엇인지 읽을 수 없었다.
            라벨과 숫자를 세로로 붙여 짝을 눈으로 바로 잇게 한다. */}
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1.5">상태별 건수</p>
          {/* 라벨은 절대 줄바꿈하지 않는다 — "부분체결"이 "부분체/결"로 쪼개져 읽히던 문제.
              칸을 균등 분할(flex-1)하면 좁은 폭에서 강제 줄바꿈이 나므로 내용 폭에 맡긴다. */}
          <div className="flex items-end justify-between gap-1 overflow-x-auto">
            {STATUS_LIST.map(s => {
              const n = summary.byStatus[s] ?? 0
              return (
                <div key={s} className="flex flex-col items-center shrink-0">
                  <span className={`text-base font-bold tabular-nums leading-none ${n > 0 ? 'text-gray-900 dark:text-slate-100' : 'text-gray-300 dark:text-slate-600'}`}>{n}</span>
                  <span className={`mt-1 whitespace-nowrap text-center text-[10px] leading-none px-1.5 py-1 rounded ${
                    n > 0 ? statusBadge(s) : 'text-gray-400 dark:text-slate-500'}`}>{s}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

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
                  {/* ⚠ trade_date 는 실제 체결일이 아니라 **발의(지시)일**이다.
                      실제 체결일은 체결(fill)마다 따로 있어 행을 펼쳐야 보인다 —
                      "집행일"이라고만 쓰면 체결일로 오독된다(2026-08-20 리포트). */}
                  {['', '매도발의일(집행일)', '법인', '구분', '통화', '외화금액', '취득환율', '매도환율', '예상 환차손익',
                    '실체결환율', '확정 환차손익', '잔여', '상태', '발의자', ''].map(h => (
                    <th key={h} title={h === '매도발의일(집행일)' ? '매각 지시를 등록한 날(집행 기준일). 실제 체결일은 행을 펼쳐 체결 내역에서 확인합니다.' : undefined}
                      className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-sky-300 whitespace-nowrap">{h}</th>
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
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-block whitespace-nowrap text-xs font-bold px-2 py-0.5 rounded ${
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
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">{r.created_by ?? ''}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex gap-1">
                            {r.status === '발의' && canApprove() && canWriteFxTrade && (
                              <button onClick={() => setApproveTarget(r)}
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
                              <button onClick={() => setCancelTarget(r)}
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

      {completeTarget && (() => {
        // 조회 결과에 없어도(기간 필터 밖) 이행 대기 목록에서 찾을 수 있어야 한다.
        const rec = hist.data.find(r => r.id === completeTarget)
          ?? pendingSorted.find(r => r.id === completeTarget)
        if (!rec) return null
        return (
          <CompleteTradeModal
            record={rec}
            onClose={() => setCompleteTarget(null)}
            onSubmit={async (amount, rate, fillDate) => {
              const { error } = await hist.fillTrade(rec.id, amount, rate, fillDate, user?.label ?? '')
              if (error) return error.message ?? String(error)
              doFetch(); onChanged()
              return null
            }}
          />
        )
      })()}

      {proposeOpen && (
        <FxOrderProposeModal
          company={company} defaultCurrency={currency}
          onClose={() => setProposeOpen(false)}
          onSubmit={async payload => {
            const { error } = await hist.propose(payload as Parameters<typeof hist.propose>[0])
            if (error) return error.message ?? String(error)
            doFetch(); onChanged()
            return null
          }}
        />
      )}

      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setApproveTarget(null) }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
              <p className="text-base font-semibold text-gray-800 dark:text-slate-100">✅ 매각 지시 승인</p>
              <p className="text-xs text-gray-400 mt-0.5">승인하면 담당자가 체결(실제 매각 실적)을 등록할 수 있게 됩니다.</p>
            </div>
            <div className="px-6 py-4 space-y-1.5 text-xs text-gray-600 dark:text-slate-300 tabular-nums">
              <p>{approveTarget.currency} {fmtNumber(approveTarget.amount_fx, approveTarget.currency === 'JPY' ? 0 : 2)} · {orderTypeLabel(approveTarget.order_type)}</p>
              <p className="text-gray-400">지시일 {approveTarget.trade_date} · 기한 {approveTarget.due_date ?? '—'}</p>
              {approveTarget.memo && <p className="text-gray-400">{approveTarget.memo}</p>}
            </div>
            <div className="px-6 pb-5 flex flex-wrap gap-2 justify-end">
              <button onClick={() => setApproveTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                닫기
              </button>
              <button onClick={() => handleApprove(false)} disabled={approving}
                className="px-4 py-2 text-sm border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 rounded-lg disabled:opacity-50">
                승인만
              </button>
              {canEdit() && canWriteFxTrade && (
                <button onClick={() => handleApprove(true)} disabled={approving}
                  className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
                  {approving ? '처리 중...' : '승인 후 체결 등록'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (() => {
        // 체결이 하나도 없는 건은 FIFO 소진도 없다 → 원장에 영향이 없음을 명시해 안심시킨다.
        const hasFills = (cancelTarget.filled_amount ?? 0) > 0
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={e => { if (e.target === e.currentTarget) setCancelTarget(null) }}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
              style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
              <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
                <p className="text-base font-semibold text-gray-800 dark:text-slate-100">↩ 매각 지시 취소</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {hasFills ? '등록된 체결이 전부 원복되고 소진된 FIFO 로트가 복원됩니다.'
                            : '등록된 체결이 없어 FIFO 원장에는 영향이 없습니다.'}
                </p>
              </div>
              <div className="px-6 py-4 space-y-1.5 text-xs text-gray-600 dark:text-slate-300 tabular-nums">
                <p>{cancelTarget.currency} {fmtNumber(cancelTarget.amount_fx, cancelTarget.currency === 'JPY' ? 0 : 2)} · 상태 {cancelTarget.status}</p>
                <p className="text-gray-400">{cancelTarget.trade_date} · {orderTypeLabel(cancelTarget.order_type)}</p>
                {hasFills && (
                  <p className="text-amber-600 dark:text-amber-400">
                    체결 완료분 {fmtNumber(cancelTarget.filled_amount ?? 0, cancelTarget.currency === 'JPY' ? 0 : 2)} 이 함께 원복됩니다.
                  </p>
                )}
              </div>
              <div className="px-6 pb-5 flex gap-2 justify-end">
                <button onClick={() => setCancelTarget(null)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                  닫기
                </button>
                <button onClick={handleCancel} disabled={cancelling}
                  className="px-5 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">
                  {cancelling ? '처리 중...' : '취소 실행'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
