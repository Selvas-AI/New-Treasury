import { useMemo, useState } from 'react'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { useFxLots } from '../../hooks/useFxLots'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { previewFifoConsumption, parseAccountPriority, ACCOUNT_TYPE_LABEL } from '../../lib/fxLots'
import type { FxTradeRecord } from '../../types'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 외화매매거래 "체결 등록" 공용 모달 — 체결 수량·체결일·실제 체결환율 입력 + 손익 미리보기.
 *
 * 세션26차 부분 체결 지원 — 매각 지시(record) 는 최대 3영업일에 걸쳐 여러 번
 * 나눠 체결될 수 있다. 이 모달은 그중 **한 번의 체결**만 기록한다. 기본 체결
 * 수량은 잔여 수량(record.amount_fx - record.filled_amount) 전체이므로, 한
 * 번에 다 체결하면 기존과 동일하게 동작한다 — 필요할 때만 수량을 줄이면 된다.
 *
 * ⚠ 여기서 요구하는 rate 는 반드시 사용자가 입력한 **실제 체결환율**이어야 한다.
 *   "현재 시장환율"을 자동으로 채워 넣고 확인 없이 완료 처리하면 실제 체결가와
 *   달라질 수 있다 — FxPolicyTab 이 과거에 그렇게 했었다(정확도 문제로 수정됨).
 *
 * ⭐ FIFO 소진 미리보기(세션26차 11일차): 체결을 등록하면 서버 RPC 가 취득일 순으로
 *   로트를 소진한다. 저장 전에는 "어느 로트에서 얼마가 빠지고 장부환율이 얼마였는지"를
 *   볼 방법이 없어, 실무자가 원장 반영 여부를 확인할 수 없다는 리포트가 있었다.
 *   여기서 보여주는 표는 `previewFifoConsumption`(서버 RPC 와 같은 규칙의 순수함수)로
 *   계산한 **예상치**다 — 실제 소진은 저장 시점 로트 상태 기준으로 서버가 다시 한다.
 */
export function CompleteTradeModal({ record, onSubmit, onClose }: {
  record: FxTradeRecord
  onSubmit: (amount: number, rate: number, fillDate: string, accountType: string | null) => Promise<string | null>
  onClose: () => void
}) {
  const remaining = Math.max(0, record.amount_fx - (record.filled_amount ?? 0))
  const [amount, setAmount] = useState(String(remaining))
  const [fillDate, setFillDate] = useState(todayStr())
  const [rate, setRate] = useState('')
  // 출금 계좌 — 달러 매각은 보통예금·MMDA 어느 쪽에서도 나갈 수 있다(회사 규칙 표).
  // 'auto' = 정책 우선순위를 따름.
  const [account, setAccount] = useState<'auto' | 'demand_deposit' | 'mmda' | 'term_deposit'>('auto')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const amtNum = Number(amount) || 0
  const overRemaining = amtNum > remaining + 0.000001

  // FIFO 원장 연동 — 이 체결이 어떤 로트를 소진하게 되는지 저장 전에 확인시킨다.
  const { lots, loading: lotsLoading } = useFxLots(record.company, record.currency)
  // 소진 순서는 정책(policy_params)이 정한다 — 서버 RPC 와 반드시 같은 값을 읽어야
  // 미리보기와 실제 소진이 일치한다.
  const params = usePolicyParams(record.company)
  const accountPriorityText = params.getText('fx_fifo_account_priority')
  const accountPriority = useMemo(() => parseAccountPriority(accountPriorityText), [accountPriorityText])
  const fifo = useMemo(() => {
    const r = Number(rate)
    if (!amtNum || !r || lots.length === 0) return null
    const scoped = account === 'auto' ? lots : lots.filter(l => l.accountType === account)
    const rows = previewFifoConsumption(scoped, amtNum, r, fillDate, accountPriority)
    const covered = rows.reduce((s, x) => s + x.amount, 0)
    return { rows, covered, shortfall: Math.max(0, amtNum - covered),
      pnl: rows.reduce((s, x) => s + x.realizedPnlKRW, 0) }
  }, [lots, amtNum, rate, fillDate, accountPriority, account])

  // 손익은 FIFO 로트 기준이 정본. 로트가 없는(원장 미적용) 법인·통화만 지시의 acq_rate 로 대체.
  const pnl = fifo ? fifo.pnl
    : amtNum && rate && record.acq_rate != null ? (Number(rate) - record.acq_rate) * amtNum
    : null

  async function handleSubmit() {
    if (!rate || !amtNum || overRemaining) return
    setSaving(true)
    setErr(null)
    const error = await onSubmit(amtNum, Number(rate), fillDate, account === 'auto' ? null : account)
    setSaving(false)
    if (error) setErr(error)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-slate-700"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
          <p className="text-base font-semibold text-gray-800 dark:text-slate-100">✅ 체결 등록</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {record.currency} 지시 {record.amount_fx.toLocaleString()} · 잔여 {remaining.toLocaleString()}
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">
                체결 수량 ({record.currency})
              </label>
              <input type="number" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                           bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">체결일</label>
              <input type="date" value={fillDate}
                onChange={e => setFillDate(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                           bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            </div>
          </div>
          {overRemaining && (
            <p className="text-xs text-red-600">체결 수량이 잔여 수량({remaining.toLocaleString()})을 초과합니다.</p>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">출금 계좌</label>
            <select value={account} onChange={e => setAccount(e.target.value as typeof account)}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white mb-3">
              <option value="auto">자동 (정책 우선순위)</option>
              <option value="demand_deposit">{ACCOUNT_TYPE_LABEL.demand_deposit}</option>
              <option value="mmda">{ACCOUNT_TYPE_LABEL.mmda}</option>
              <option value="term_deposit">{ACCOUNT_TYPE_LABEL.term_deposit}</option>
            </select>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">실제 체결 환율</label>
            <input type="number" step="0.01" value={rate}
              onChange={e => setRate(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums"
              placeholder="예: 1295.50" />
          </div>
          {pnl != null && (
            <div className={`px-3 py-2 rounded-lg text-xs font-medium ${pnl >= 0
              ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'}`}>
              이번 체결 환차{pnl >= 0 ? '익' : '손'}: {pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(pnl))}
              {fifo && <span className="ml-1 font-normal opacity-70">(FIFO 로트 장부환율 기준)</span>}
            </div>
          )}

          {/* FIFO 소진 미리보기 — 원장(fx_lots)에서 어느 재고가 빠지는지 저장 전 확인 */}
          <div className="rounded-lg border border-gray-200 dark:border-slate-600 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">
              📒 FIFO 소진 예정 (외화거래명세 원장 자동 반영)
              {accountPriorityText && (
                <span className="ml-1 font-normal text-gray-400">
                  · 계좌 우선순위 {accountPriorityText.split(',').map(t => ACCOUNT_TYPE_LABEL[t.trim() as keyof typeof ACCOUNT_TYPE_LABEL] ?? t.trim()).join(' → ')}
                </span>
              )}
            </p>
            {lotsLoading ? (
              <p className="mt-1 text-xs text-gray-400">보유 로트 불러오는 중…</p>
            ) : lots.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">
                이 법인·통화에는 FIFO 로트가 없습니다 — 체결 이력만 기록되고 원장 차감은 일어나지 않습니다.
              </p>
            ) : !fifo ? (
              <p className="mt-1 text-xs text-gray-400">체결 수량과 환율을 입력하면 소진될 로트를 보여줍니다.</p>
            ) : (
              <>
                <table className="mt-1.5 w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="text-left font-medium">취득일</th>
                      <th className="text-right font-medium">소진 금액</th>
                      <th className="text-right font-medium">장부환율</th>
                      <th className="text-right font-medium">실현손익</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 dark:text-slate-300">
                    {fifo.rows.map(r => {
                      const lot = lots.find(l => l.id === r.lotId)
                      return (
                        <tr key={r.lotId}>
                          <td className="py-0.5">
                            {r.acquiredDate}
                            {lot && <span className="ml-1 text-gray-400">{ACCOUNT_TYPE_LABEL[lot.accountType]}</span>}
                          </td>
                          <td className="py-0.5 text-right">{fmtNumber(r.amount, record.currency === 'JPY' ? 0 : 2)}</td>
                          <td className="py-0.5 text-right">{fmtNumber(r.acqRate, 2)}</td>
                          <td className={`py-0.5 text-right ${r.realizedPnlKRW >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            {r.realizedPnlKRW >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(r.realizedPnlKRW))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {fifo.shortfall > 0 && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    ⚠ 환전 가능 재고가 {fmtNumber(fifo.shortfall, record.currency === 'JPY' ? 0 : 2)} {record.currency} 부족합니다
                    (정기예금은 만기 전 소진 불가). 이대로 저장하면 서버에서 거부될 수 있습니다.
                  </p>
                )}
              </>
            )}
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
            취소
          </button>
          <button onClick={handleSubmit} disabled={saving || !rate || !amtNum || overRemaining}
            className="px-5 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '저장 중...' : '체결 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
