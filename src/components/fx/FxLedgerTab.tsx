import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { fmtNumber } from '../../lib/format'
import { ACCOUNT_TYPE_LABEL, type FxAccountType, type FxLot } from '../../lib/fxLots'
import { FillConsumptionCard } from './FillConsumptionDetail'
import { useFxLedgerReconciliation } from '../../hooks/useFxLedgerReconciliation'
import type { FxTradeFill, FxLotConsumption, FxTradeRecord, Company, FxCode } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const ACCOUNT_TYPE_OPTIONS: { value: FxAccountType; label: string }[] = [
  { value: 'demand_deposit', label: ACCOUNT_TYPE_LABEL.demand_deposit },
  { value: 'mmda',           label: ACCOUNT_TYPE_LABEL.mmda },
  { value: 'term_deposit',   label: ACCOUNT_TYPE_LABEL.term_deposit },
]

type TimelineRowBase =
  | { kind: 'inflow';  date: string; amount: number; lot: FxLot }
  | { kind: 'outflow'; date: string; amount: number; fill: FxTradeFill }
type TimelineRow = TimelineRowBase & { balance: number }

/**
 * ① 원장 탭 — 유입(로트 취득)과 유출(체결)을 날짜순으로 합쳐 잔액이 누적 계산되는
 * 단일 타임라인으로 보여준다. 계정잔액명세처럼 "언제 들어온 외화가 언제 얼마나
 * 처분됐고 지금 얼마 남았는지"를 한 화면에서 볼 수 있게 하는 것이 목적(세션26차 4일차).
 *
 * 기존 "보유 로트"+"매각 이력" 두 탭을 대체한다. 개시 이전(2026년) CSV 로 이관한
 * 과거 매각 실적은 FIFO 로트를 소진하지 않은 순수 과거 실적이라 이 타임라인에는
 * 나타나지 않는다 — 그 건들은 ③ 로트 설정 탭에서 관리한다.
 */
export function FxLedgerTab({
  company, lots, fills, consumptionsByFillId, loading, currency, totalAmount, pendingOrders,
  onUpdateLot, onDeleteLot, onReconcileInflow, onReconcileOutflow, onGotoOrders, onChanged,
}: {
  company: Company
  lots: FxLot[]
  fills: FxTradeFill[]
  consumptionsByFillId: Record<string, FxLotConsumption[]>
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
  const [expandedFillId, setExpandedFillId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const merged = useMemo(() => {
    const rows: TimelineRowBase[] = [
      ...lots.map(lot => ({ kind: 'inflow' as const, date: lot.acquiredDate, amount: lot.originalAmount, lot })),
      ...fills.map(fill => ({ kind: 'outflow' as const, date: fill.fill_date, amount: fill.amount_fx, fill })),
    ]
    rows.sort((a, b) => a.date === b.date
      ? (a.kind === b.kind ? 0 : a.kind === 'inflow' ? -1 : 1)
      : a.date.localeCompare(b.date))
    let balance = 0
    const withBalance: TimelineRow[] = rows.map(row => {
      balance += row.kind === 'inflow' ? row.amount : -row.amount
      return row.kind === 'inflow' ? { ...row, balance } : { ...row, balance }
    })
    return withBalance.reverse() // 최신순 표시
  }, [lots, fills])

  const finalBalance = merged[0]?.balance ?? 0
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
          ⚠ 잔액 불일치 감지 — 타임라인 계산 잔액({finalBalance.toLocaleString()})과 로트 잔여 합계({totalAmount.toLocaleString()})가 다릅니다.
          체결 데이터가 아직 반영 중이거나 조회 범위(최대 1,000건)를 넘는 이력이 있을 수 있습니다.
        </div>
      )}

      <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-sm font-semibold">자금일보 미반영 증감 ({currency})</div>
            <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
              조회 시작일
              <input type="date" value={reconcileFrom} onChange={e => setReconcileFrom(e.target.value)}
                className="rounded border px-2 py-1 text-xs dark:bg-slate-800" />
            </label>
          </div>
          <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">
            운전자금(자금일보) 잔액이 전일 대비 변동했지만 아직 원장에 반영되지 않았습니다.
            실제 장부에 적용한 환율만 입력하면 유입 로트 생성 또는 FIFO 소진으로 자동 반영됩니다.
            개시 로트가 이미 흡수한 과거 날짜라면 "무시"로 목록에서 뺄 수 있습니다(원장 데이터는 바뀌지 않습니다).
          </div>
          {reconcile.loading ? (
            <div className="text-xs text-gray-500">조회 중…</div>
          ) : (
            <div className="space-y-2">
              {reconcile.items.map(item => (
                <div key={item.dailyId} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${item.direction === 'in'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'}`}>
                    {item.direction === 'in' ? '유입' : '유출'}
                  </span>
                  <span className="text-xs text-gray-600 dark:text-slate-300">{item.date}</span>
                  <span className="text-xs font-medium tabular-nums">
                    {fmtNumber(item.amount, currency === 'JPY' ? 0 : 2)} {currency}
                  </span>
                  {dismissTarget === item.dailyId ? (
                    <span className="ml-auto flex items-center gap-1.5 text-xs">
                      <span className="text-gray-500 dark:text-slate-400">목록에서 뺄까요?</span>
                      <button onClick={() => void handleDismiss(item)} disabled={dismissing === item.dailyId}
                        className="rounded bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50">
                        {dismissing === item.dailyId ? '처리 중…' : '무시 확정'}
                      </button>
                      <button onClick={() => setDismissTarget(null)}
                        className="rounded border px-2.5 py-1 text-gray-600 dark:text-slate-300">취소</button>
                    </span>
                  ) : (
                    <>
                      <input type="number" step="0.01" placeholder="실제 적용 환율"
                        value={reconcileRates[item.dailyId] ?? ''}
                        onChange={e => setReconcileRates(prev => ({ ...prev, [item.dailyId]: e.target.value }))}
                        className="ml-auto w-32 rounded border px-2 py-1 text-xs text-right dark:bg-slate-800" />
                      <button onClick={() => void handleReconcile(item)} disabled={reconciling === item.dailyId}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                        {reconciling === item.dailyId ? '반영 중…' : '원장 반영'}
                      </button>
                      <button onClick={() => setDismissTarget(item.dailyId)}
                        className="rounded border border-gray-300 dark:border-slate-600 px-2.5 py-1 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700">
                        무시
                      </button>
                    </>
                  )}
                </div>
              ))}
              {reconcile.items.length === 0 && (
                <div className="text-xs text-gray-400">조회 시작일 이후 미반영 증감이 없습니다.</div>
              )}
            </div>
          )}
      </div>

      {pendingOrders.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950/20">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-red-800 dark:text-red-300">
              🔴 이행 대기 매각 지시 {pendingOrders.length}건 · 합계{' '}
              {fmtNumber(pendingOrders.reduce((s, o) => s + Math.max(0, o.amount_fx - (o.filled_amount ?? 0)), 0), currency === 'JPY' ? 0 : 2)} {currency}
            </div>
            <button onClick={onGotoOrders}
              className="text-xs px-2.5 py-1 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded hover:bg-red-100 dark:hover:bg-red-900/30 whitespace-nowrap">
              매각 지시 관리 탭으로 →
            </button>
          </div>
        </div>
      )}

      {message && <div className="text-xs font-medium text-blue-700 dark:text-blue-300">{message}</div>}

      <div className={CARD}>
        <div className="mb-2 text-sm font-semibold">원장 — 유입·유출 통합 타임라인 ({currency})</div>
        {loading ? (
          <div className="text-xs text-gray-500">조회 중…</div>
        ) : merged.length === 0 ? (
          <div className="text-xs text-gray-500">아직 유입·유출 이력이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 w-6"></th>
                  <th className="py-2">일자</th><th>구분</th><th>내용</th>
                  <th className="text-right">금액</th><th className="text-right">환율</th>
                  <th className="text-right">잔액</th><th className="text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {merged.map(row => row.kind === 'inflow' ? (
                  <tr key={`lot-${row.lot.id}`} className="border-b border-gray-100 dark:border-slate-800">
                    <td></td>
                    <td className="py-2">{row.date}</td>
                    <td><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">유입</span></td>
                    <td>
                      {ACCOUNT_TYPE_LABEL[row.lot.accountType]}
                      {row.lot.accountType === 'term_deposit' && row.lot.maturityDate && (
                        <span className="ml-1 text-gray-400">(만기 {row.lot.maturityDate})</span>
                      )}
                      {row.lot.remainingAmount < row.lot.originalAmount && (
                        <span className="ml-1 text-gray-400">· 잔여 {row.lot.remainingAmount.toLocaleString()}</span>
                      )}
                      {row.lot.memo && <span className="ml-1 text-gray-300 dark:text-slate-600">· {row.lot.memo}</span>}
                    </td>
                    <td className="text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">+{row.amount.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{row.lot.acqRate.toLocaleString()}</td>
                    <td className="text-right tabular-nums font-semibold">{row.balance.toLocaleString()}</td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit() && <button onClick={() => setEditingLot(row.lot)} className="text-blue-600 hover:underline">수정</button>}
                      {canDelete() && <button onClick={() => setPendingDeleteLot(row.lot)} className="ml-2 text-red-600 hover:underline">삭제</button>}
                    </td>
                  </tr>
                ) : (
                  <Fragment key={`fill-${row.fill.id}`}>
                    <tr className="border-b border-gray-100 dark:border-slate-800">
                      <td className="py-2">
                        <button onClick={() => setExpandedFillId(expandedFillId === row.fill.id ? null : row.fill.id)}
                          className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200" title="소진 로트 보기">
                          {expandedFillId === row.fill.id ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="py-2">{row.date}</td>
                      <td><span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">유출</span></td>
                      <td>매각 체결{row.fill.completed_by && <span className="ml-1 text-gray-400">· {row.fill.completed_by}</span>}</td>
                      <td className="text-right tabular-nums font-medium text-orange-600 dark:text-orange-400">-{row.amount.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{row.fill.completed_rate.toLocaleString()}</td>
                      <td className="text-right tabular-nums font-semibold">{row.balance.toLocaleString()}</td>
                      <td className="text-right whitespace-nowrap text-gray-400">—</td>
                    </tr>
                    {expandedFillId === row.fill.id && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50 dark:bg-slate-900/60 pl-10 pr-4 py-3">
                          <FillConsumptionCard fill={row.fill} index={0} label="매각 체결 상세"
                            consumptions={consumptionsByFillId[row.fill.id] ?? []}
                            canReverse={false} onRequestReverse={() => {}} />
                          {(canApprove() && canWriteFxTrade) && (
                            <p className="mt-1.5 text-[11px] text-gray-400">
                              이 체결을 취소하려면 매각 지시 관리 탭에서 해당 지시를 펼쳐 "이 체결만 취소"를 사용하세요.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
