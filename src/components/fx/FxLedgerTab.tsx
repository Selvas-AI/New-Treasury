import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { ACCOUNT_TYPE_LABEL, type FxAccountType, type FxLot } from '../../lib/fxLots'
import { outflowTxnLabel } from '../../lib/fxTxnType'
import { useFxLedgerReconciliation } from '../../hooks/useFxLedgerReconciliation'
import type { FxTradeFill, FxLotConsumption, FxTradeRecord, Company, FxCode } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const ACCOUNT_TYPE_OPTIONS: { value: FxAccountType; label: string }[] = [
  { value: 'demand_deposit', label: ACCOUNT_TYPE_LABEL.demand_deposit },
  { value: 'mmda',           label: ACCOUNT_TYPE_LABEL.mmda },
  { value: 'term_deposit',   label: ACCOUNT_TYPE_LABEL.term_deposit },
]

type SortKey = 'acquiredDate' | 'state' | 'account' | 'original' | 'disposed' | 'remaining' | 'acqRate'
type LotState = 'open' | 'partial' | 'done'

const STATE_LABEL: Record<LotState, string> = { open: '잔존', partial: '소진 중', done: '소진 완료' }
const STATE_ORDER: Record<LotState, number> = { open: 0, partial: 1, done: 2 }

function lotState(lot: FxLot): LotState {
  if (lot.remainingAmount <= 0.000001) return 'done'
  return lot.originalAmount - lot.remainingAmount > 0.000001 ? 'partial' : 'open'
}

const SOURCE_LABEL: Record<string, string> = {
  fx_trade_history:   '매각 체결',
  daily_report_item:  '자금일보 반영',
  manual:             '수동 유출',
  transfer:           '계좌 대체',
  interest:           '이자 수취',
  investment:         '운용자금 연동',
}

/**
 * ① 원장 탭 — **재고 명세**(계정잔액명세형). 로트 1건 = 1행으로, 언제 들어온 외화가
 * 얼마나 처분됐고 지금 얼마 남았는지를 보여준다. 처분금액을 펼치면 그 로트가 언제·
 * 어떤 경로로 소진됐는지 상세가 나온다.
 *
 * ⚠ 과거엔 여기에 유출(체결) 행을 날짜순으로 섞어 넣은 "타임라인"이었다. 두 가지 문제가 있었다:
 *   1. 같은 처분이 표에 **두 번** 나왔다 — 로트 행의 `처분금액`(생애 누적)과 유출 행의 금액.
 *      축이 다른 두 모델(재고 명세 vs 거래 타임라인)을 한 표에 섞은 결과다.
 *   2. 자금일보 반영·수동 유출은 `fx_trade_fills` 행이 없어 **원장에서 통째로 누락**됐다
 *      (잔액만 조용히 줄어듦). 이제 소진 내역(fx_lot_consumptions)을 직접 읽어 전부 나온다.
 *   시간순 처분 조회는 **외화매도이력 탭**이 정본이다 — 원장은 재고, 매도이력은 거래.
 */
export function FxLedgerTab({
  company, lots, fills, consumptionsByLotId, loading, currency, totalAmount, pendingOrders,
  onUpdateLot, onDeleteLot, onReconcileInflow, onReconcileOutflow, onGotoOrders, onChanged,
}: {
  company: Company
  lots: FxLot[]
  /** 로트별 소진 내역 — 매각 체결/자금일보/수동 유출을 모두 포함한다 */
  consumptionsByLotId: Record<string, FxLotConsumption[]>
  /** 소진 내역의 fill_id → 체결일 등 부가 표시용 */
  fills: FxTradeFill[]
  loading: boolean
  currency: FxCode
  totalAmount: number
  pendingOrders: FxTradeRecord[]
  onUpdateLot: (id: string, values: { acquiredDate: string; amount: number; acqRate: number; accountType: FxAccountType; annualInterestRate: number; maturityDate: string | null; memo: string }) => Promise<string | null>
  onDeleteLot: (id: string) => Promise<string | null>
  onReconcileInflow: (dailyId: string, amount: number, rate: number, date: string) => Promise<string | null>
  onReconcileOutflow: (dailyId: string, amount: number, rate: number, date: string) => Promise<string | null>
  onGotoOrders: () => void
  onChanged: () => void
}) {
  const { user, canEdit, canDelete, canApprove, canAction } = useAuth()
  // 조회 시작일 — 개시 로트(source_type='opening')는 개시일 이전 이력을 이미 흡수한
  // 잔고라, 기본값을 이번 달 1일로 잡아 개시 이전 날짜가 무더기로 잡히지 않게 한다.
  // 경계 근처 날짜는 아래 "무시" 버튼으로 개별 처리하거나 이 값을 더 당겨서 확인한다.
  const [reconcileFrom, setReconcileFrom] = useState(() => new Date().toISOString().slice(0, 8) + '01')
  const reconcile = useFxLedgerReconciliation(company, currency, reconcileFrom)
  const [reconcileRates, setReconcileRates] = useState<Record<string, string>>({})
  const [reconciling, setReconciling] = useState<string | null>(null)
  const [dismissTarget, setDismissTarget] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const canWriteFxTrade = canAction('fx_trade', 'write')
  const [editingLot, setEditingLot] = useState<FxLot | null>(null)
  const [pendingDeleteLot, setPendingDeleteLot] = useState<FxLot | null>(null)
  const [expandedLotId, setExpandedLotId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [accountFilter, setAccountFilter] = useState<'all' | FxAccountType>('all')

  /** 체결일 등 부가 표시용 — 소진 내역의 fill_id 로 조회한다 */
  const fillById = useMemo(() => new Map(fills.map(f => [f.id, f])), [fills])

  // 정렬·필터 — 로트가 수십 건 쌓이면 눈으로 훑기 어려워진다.
  const [sortKey, setSortKey] = useState<SortKey>('acquiredDate')
  const [sortAsc, setSortAsc] = useState(false)
  const [stateFilter, setStateFilter] = useState<'all' | LotState>('all')
  const [minAmount, setMinAmount] = useState('')   // 잔액 기준 하한

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortAsc(v => !v)
    else { setSortKey(k); setSortAsc(k === 'acquiredDate' ? false : true) }
  }

  const rows = useMemo(() => {
    const min = Number(minAmount) || 0
    const filtered = lots.filter(lot =>
      (accountFilter === 'all' || lot.accountType === accountFilter)
      && (stateFilter === 'all' || lotState(lot) === stateFilter)
      && lot.remainingAmount >= min)
    const dir = sortAsc ? 1 : -1
    return filtered.sort((a, b) => {
      const cmp =
        sortKey === 'acquiredDate' ? a.acquiredDate.localeCompare(b.acquiredDate)
        : sortKey === 'state'      ? STATE_ORDER[lotState(a)] - STATE_ORDER[lotState(b)]
        : sortKey === 'account'    ? a.accountType.localeCompare(b.accountType)
        : sortKey === 'original'   ? a.originalAmount - b.originalAmount
        : sortKey === 'disposed'   ? (a.originalAmount - a.remainingAmount) - (b.originalAmount - b.remainingAmount)
        : sortKey === 'remaining'  ? a.remainingAmount - b.remainingAmount
        : a.acqRate - b.acqRate
      return (cmp || a.id.localeCompare(b.id)) * dir
    })
  }, [lots, accountFilter, stateFilter, minAmount, sortKey, sortAsc])



  // 무결성 확인용 — 화면에는 표시하지 않고, 전체 로트 잔여 합계가 어긋날 때만 경고한다
  // (계좌유형 필터와 무관하게 항상 전체 기준으로 검증).
  const finalBalance = useMemo(() => lots.reduce((s, l) => s + l.remainingAmount, 0), [lots])
  const balanceMismatch = Math.abs(finalBalance - totalAmount) > 0.5

  async function saveLotEdit() {
    if (!editingLot) return
    const err = await onUpdateLot(editingLot.id, {
      acquiredDate: editingLot.acquiredDate, amount: editingLot.originalAmount, acqRate: editingLot.acqRate,
      accountType: editingLot.accountType, annualInterestRate: editingLot.annualInterestRate,
      maturityDate: editingLot.maturityDate ?? null, memo: editingLot.memo ?? '',
    })
    setMessage(err ?? '로트를 수정했습니다.')
    if (!err) { setEditingLot(null); onChanged() }
  }

  async function removeLot() {
    if (!pendingDeleteLot) return
    const err = await onDeleteLot(pendingDeleteLot.id)
    setMessage(err ?? '로트를 삭제했습니다.')
    if (!err) { setPendingDeleteLot(null); onChanged() }
  }

  async function handleReconcile(item: { dailyId: string; date: string; direction: 'in' | 'out'; amount: number }) {
    const rateStr = reconcileRates[item.dailyId]
    const rate = Number(rateStr)
    if (!rateStr || !(rate > 0)) { setMessage('실제 적용 환율을 입력하세요.'); return }
    setReconciling(item.dailyId)
    setMessage(null)
    const err = item.direction === 'in'
      ? await onReconcileInflow(item.dailyId, item.amount, rate, item.date)
      : await onReconcileOutflow(item.dailyId, item.amount, rate, item.date)
    setReconciling(null)
    if (err) { setMessage(err); return }
    setReconcileRates(prev => { const next = { ...prev }; delete next[item.dailyId]; return next })
    void reconcile.reload()
    onChanged()
  }

  async function handleDismiss(item: { dailyId: string; date: string; direction: 'in' | 'out'; amount: number }) {
    setDismissing(item.dailyId)
    const err = await reconcile.dismiss(item, user?.code ?? 'unknown')
    setDismissing(null)
    if (err) { setMessage(err); return }
    setDismissTarget(null)
  }

  return (
    <div className="space-y-4">
      {balanceMismatch && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          ⚠ 잔액 불일치 감지 — 로트 잔여 합계({finalBalance.toLocaleString()})와 원장 통계({totalAmount.toLocaleString()})가 다릅니다.
          데이터가 아직 반영 중이거나 조회 범위(최대 1,000건)를 넘는 이력이 있을 수 있습니다.
        </div>
      )}

      {pendingOrders.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950/20">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-red-800 dark:text-red-300">
              🔴 이행 대기 매각 지시 {pendingOrders.length}건 · 합계{' '}
              {fmtNumber(pendingOrders.reduce((s, o) => s + Math.max(0, o.amount_fx - (o.filled_amount ?? 0)), 0), currency === 'JPY' ? 0 : 2)} {currency}
            </div>
            <button onClick={onGotoOrders}
              className="text-xs px-2.5 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded hover:bg-red-100 dark:hover:bg-red-900/30 whitespace-nowrap">
              외화매도이력 탭으로 →
            </button>
          </div>
        </div>
      )}

      {message && <div className="text-xs font-medium text-blue-700 dark:text-blue-300">{message}</div>}

      {/* 원장(FIFO) : 자금일보 미반영 증감 = 대략 7:3 로 한 행에 배치 */}
      <div className="grid gap-4 lg:grid-cols-[7fr_3fr] items-start">
        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-sm font-semibold">원장 ({currency})</div>
            <div className="flex gap-1">
              {(['all', 'demand_deposit', 'mmda', 'term_deposit'] as const).map(t => (
                <button key={t} onClick={() => setAccountFilter(t)}
                  className={`rounded px-2 py-1 text-[11px] font-medium ${accountFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {t === 'all' ? '전체' : ACCOUNT_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          {/* 상태·잔액 필터 (계좌유형은 위 탭) */}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-gray-400">상태</span>
            {(['all', 'open', 'partial', 'done'] as const).map(s => (
              <button key={s} onClick={() => setStateFilter(s)}
                className={`rounded px-2 py-0.5 font-medium ${stateFilter === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {s === 'all' ? '전체' : STATE_LABEL[s]}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-gray-400">
              잔액 ≥
              <input type="number" min={0} value={minAmount} onChange={e => setMinAmount(e.target.value)}
                placeholder="0"
                className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
            </label>
            <span className="ml-auto text-gray-400">{rows.length} / {lots.length}건</span>
          </div>
          {loading ? (
            <div className="text-xs text-gray-500">조회 중…</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-gray-500">조건에 맞는 재고가 없습니다.</div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: '26rem' }}>
              <table className="w-full min-w-[760px] text-xs">
                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                  <tr className="border-b text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 w-6"></th>
                    {([
                      ['acquiredDate', '유입일',   'left'],
                      ['state',        '상태',     'left'],
                      ['account',      '계좌',     'left'],
                      ['original',     '최초유입', 'right'],
                      ['disposed',     '처분금액', 'right'],
                      ['remaining',    '잔액',     'right'],
                      ['acqRate',      '장부환율', 'right'],
                    ] as [SortKey, string, 'left' | 'right'][]).map(([k, label, align]) => (
                      <th key={k} className={`whitespace-nowrap py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
                        <button onClick={() => toggleSort(k)}
                          className="inline-flex items-center gap-0.5 hover:text-gray-800 dark:hover:text-slate-100"
                          title="클릭해 정렬">
                          {label}
                          <span className={sortKey === k ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-slate-600'}>
                            {sortKey === k ? (sortAsc ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th className="text-right whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(lot => {
                    const cons = consumptionsByLotId[lot.id] ?? []
                    const disposed = lot.originalAmount - lot.remainingAmount
                    const state = lotState(lot)
                    const expanded = expandedLotId === lot.id
                    return (
                      <Fragment key={lot.id}>
                        <tr className="border-b border-gray-100 dark:border-slate-800">
                          <td className="py-2">
                            {cons.length > 0 && (
                              <button onClick={() => setExpandedLotId(expanded ? null : lot.id)}
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200" title="처분 내역 보기">
                                {expanded ? '▾' : '▸'}
                              </button>
                            )}
                          </td>
                          <td className="py-2 whitespace-nowrap">{lot.acquiredDate}</td>
                          <td className="whitespace-nowrap">
                            <span className={`rounded px-1.5 py-0.5 whitespace-nowrap ${
                              state === 'done'
                                ? 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                                : state === 'partial'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>
                              {STATE_LABEL[state]}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">
                            {ACCOUNT_TYPE_LABEL[lot.accountType]}
                            {lot.accountType === 'term_deposit' && lot.maturityDate && (
                              <span className="ml-1 text-gray-400">(만기 {lot.maturityDate})</span>
                            )}
                          </td>
                          <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{lot.originalAmount.toLocaleString()}</td>
                          <td className="text-right tabular-nums">
                            {disposed > 0.000001 ? (
                              <button onClick={() => setExpandedLotId(expanded ? null : lot.id)}
                                className="font-medium text-orange-600 underline decoration-dotted underline-offset-2 hover:text-orange-700 dark:text-orange-400"
                                title="언제 어떤 경로로 처분됐는지 보기">
                                -{disposed.toLocaleString()}
                              </button>
                            ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                          </td>
                          <td className="text-right tabular-nums font-semibold">{lot.remainingAmount.toLocaleString()}</td>
                          <td className="text-right tabular-nums">{lot.acqRate.toLocaleString()}</td>
                          <td className="text-right whitespace-nowrap">
                            {canEdit() && <button onClick={() => setEditingLot(lot)} className="text-blue-600 hover:underline">수정</button>}
                            {canDelete() && <button onClick={() => setPendingDeleteLot(lot)} className="ml-2 text-red-600 hover:underline">삭제</button>}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={9} className="bg-gray-50 dark:bg-slate-900/60 pl-10 pr-4 py-3">
                              <p className="mb-1.5 text-[11px] font-semibold text-gray-600 dark:text-slate-300">
                                처분 내역 — {lot.acquiredDate} 유입분 (장부환율 {lot.acqRate.toLocaleString()})
                              </p>
                              <table className="w-full text-[11px] tabular-nums">
                                <thead>
                                  <tr className="text-left text-gray-400">
                                    <th className="font-medium">처분일</th>
                                    <th className="font-medium">경로</th>
                                    <th className="text-right font-medium">금액</th>
                                    <th className="text-right font-medium">처분환율</th>
                                    <th className="text-right font-medium">실현손익</th>
                                  </tr>
                                </thead>
                                <tbody className="text-gray-600 dark:text-slate-300">
                                  {cons.map(c => (
                                    <tr key={c.id}>
                                      <td className="py-0.5 whitespace-nowrap">{c.disposed_date}</td>
                                      <td className="whitespace-nowrap">
                                        <span className="mr-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                                          {outflowTxnLabel(c.txn_type)}
                                        </span>
                                        {SOURCE_LABEL[c.source_type ?? ''] ?? '기타'}
                                        {c.fill_id && fillById.get(c.fill_id)?.completed_by && (
                                          <span className="ml-1 text-gray-400">· {fillById.get(c.fill_id)?.completed_by}</span>
                                        )}
                                      </td>
                                      <td className="text-right text-orange-600 dark:text-orange-400">-{c.amount.toLocaleString()}</td>
                                      <td className="text-right">{c.disposal_rate.toLocaleString()}</td>
                                      <td className={`text-right ${c.realized_pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                        {c.realized_pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(c.realized_pnl))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {(canApprove() && canWriteFxTrade) && (
                                <p className="mt-1.5 text-[11px] text-gray-400">
                                  매각 체결분을 되돌리려면 외화매도이력 탭에서 해당 지시를 펼쳐 "이 체결만 취소"를 사용하세요.
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            재고(로트) 기준 명세입니다. 날짜순 처분 이력은 <strong>외화매도이력</strong> 탭에서 확인하세요.
          </p>
        </div>

        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-sm font-semibold">자금일보 미반영</div>
          </div>
          <label className="mb-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
            조회 시작일
            <input type="date" value={reconcileFrom} onChange={e => setReconcileFrom(e.target.value)}
              className="rounded border px-2 py-1 text-xs dark:bg-slate-800" />
          </label>
          <div className="mb-3 text-[11px] text-gray-500 dark:text-slate-400">
            적용 환율만 입력하면 유입/FIFO 소진으로 자동 반영됩니다. 개시 로트가 이미 흡수한 과거 날짜는 "무시"로 뺄 수 있습니다.
          </div>
          {reconcile.loading ? (
            <div className="text-xs text-gray-500">조회 중…</div>
          ) : (
            <div className="space-y-2">
              {reconcile.items.map(item => (
                <div key={item.dailyId} className="rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${item.direction === 'in'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'}`}>
                      {item.direction === 'in' ? '유입' : '유출'}
                    </span>
                    <span className="text-gray-600 dark:text-slate-300">{item.date}</span>
                    <span className="ml-auto font-medium tabular-nums">
                      {fmtNumber(item.amount, currency === 'JPY' ? 0 : 2)}
                    </span>
                  </div>
                  {dismissTarget === item.dailyId ? (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-gray-500 dark:text-slate-400">목록에서 뺄까요?</span>
                      <button onClick={() => void handleDismiss(item)} disabled={dismissing === item.dailyId}
                        className="ml-auto rounded bg-red-600 px-2 py-1 font-semibold text-white disabled:opacity-50">
                        {dismissing === item.dailyId ? '처리 중…' : '무시 확정'}
                      </button>
                      <button onClick={() => setDismissTarget(null)}
                        className="rounded border px-2 py-1 text-gray-600 dark:text-slate-300">취소</button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input type="number" step="0.01" placeholder="적용 환율"
                        value={reconcileRates[item.dailyId] ?? ''}
                        onChange={e => setReconcileRates(prev => ({ ...prev, [item.dailyId]: e.target.value }))}
                        className="w-20 rounded border px-1.5 py-1 text-right dark:bg-slate-800" />
                      <button onClick={() => void handleReconcile(item)} disabled={reconciling === item.dailyId}
                        className="rounded bg-blue-600 px-2 py-1 font-semibold text-white disabled:opacity-50">
                        {reconciling === item.dailyId ? '반영 중…' : '반영'}
                      </button>
                      <button onClick={() => setDismissTarget(item.dailyId)}
                        className="ml-auto rounded border border-gray-300 dark:border-slate-600 px-2 py-1 text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700">
                        무시
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {reconcile.items.length === 0 && (
                <div className="text-xs text-gray-400">조회 시작일 이후 미반영 증감이 없습니다.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {editingLot && (
        <div className={CARD}>
          <div className="mb-2 text-sm font-semibold">개시 로트 수정</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">취득일<input type="date" value={editingLot.acquiredDate} onChange={e => setEditingLot({ ...editingLot, acquiredDate: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
            <label className="text-xs">외화 금액<input type="number" min={0} value={editingLot.originalAmount} onChange={e => setEditingLot({ ...editingLot, originalAmount: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
            <label className="text-xs">장부환율<input type="number" min={0} value={editingLot.acqRate} onChange={e => setEditingLot({ ...editingLot, acqRate: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
            <label className="text-xs">계좌 유형<select value={editingLot.accountType} onChange={e => setEditingLot({ ...editingLot, accountType: e.target.value as FxAccountType, maturityDate: e.target.value === 'term_deposit' ? editingLot.maturityDate : null })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">{ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            {editingLot.accountType !== 'demand_deposit' && <label className="text-xs">연이율 (%)<input type="number" min={0} step="0.01" value={editingLot.annualInterestRate} onChange={e => setEditingLot({ ...editingLot, annualInterestRate: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>}
            {editingLot.accountType === 'term_deposit' && <label className="text-xs">만기일<input type="date" min={editingLot.acquiredDate} value={editingLot.maturityDate ?? ''} onChange={e => setEditingLot({ ...editingLot, maturityDate: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>}
            <label className="text-xs">메모<input value={editingLot.memo ?? ''} onChange={e => setEditingLot({ ...editingLot, memo: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void saveLotEdit()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">수정 저장</button>
            <button onClick={() => setEditingLot(null)} className="rounded border px-3 py-1.5 text-xs">취소</button>
          </div>
        </div>
      )}

      {pendingDeleteLot && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm dark:border-red-700 dark:bg-red-900/20">
          <div className="text-sm font-bold text-red-800 dark:text-red-200">삭제 전 확인</div>
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {pendingDeleteLot.acquiredDate} {pendingDeleteLot.remainingAmount.toLocaleString()} {pendingDeleteLot.currency} 로트를 삭제합니다. 소진 이력이 있으면 서버가 거부합니다.
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void removeLot()} className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">삭제 실행</button>
            <button onClick={() => setPendingDeleteLot(null)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs dark:bg-slate-800">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
