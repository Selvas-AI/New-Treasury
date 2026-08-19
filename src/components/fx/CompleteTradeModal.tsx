import { useState } from 'react'
import { fmtKRW } from '../../lib/format'
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
 */
export function CompleteTradeModal({ record, onSubmit, onClose }: {
  record: FxTradeRecord
  onSubmit: (amount: number, rate: number, fillDate: string) => Promise<string | null>
  onClose: () => void
}) {
  const remaining = Math.max(0, record.amount_fx - (record.filled_amount ?? 0))
  const [amount, setAmount] = useState(String(remaining))
  const [fillDate, setFillDate] = useState(todayStr())
  const [rate, setRate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const amtNum = Number(amount) || 0
  const overRemaining = amtNum > remaining + 0.000001
  const pnl = amtNum && rate && record.acq_rate != null
    ? (Number(rate) - record.acq_rate) * amtNum
    : null

  async function handleSubmit() {
    if (!rate || !amtNum || overRemaining) return
    setSaving(true)
    setErr(null)
    const error = await onSubmit(amtNum, Number(rate), fillDate)
    setSaving(false)
    if (error) setErr(error)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
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
            </div>
          )}
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
