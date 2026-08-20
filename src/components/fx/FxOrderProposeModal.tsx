import { useMemo, useState } from 'react'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { addBizDays, todayStr } from '../../lib/bizDay'
import { useFxLots } from '../../hooks/useFxLots'
import { useFx } from '../../hooks/useFx'
import { ORDER_TYPE_LABEL, type FxOrderType } from '../../lib/fxOrderType'
import type { Company, FxCode } from '../../types'

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const ORDER_TYPES: FxOrderType[] = ['discretionary', 'threshold', 'regime']

const FIELD = 'w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
const LABEL = 'text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1'

/**
 * 매각 지시 직접 등록 (세션26차 11일차).
 *
 * ⭐ 왜 필요한가: 기존 발의 경로는 전부 **자동 계산된 금액**만 등록할 수 있었다.
 *   - 자금정책 한도초과 발의 → 초과 안분액 고정
 *   - 리짐 권고 발의        → 판정 결과 금액 고정
 *   - 재량 매각 지시        → 자금정책 메뉴 권한 필요
 *   그래서 "정책회의에서 300만불 매각을 결정했다"처럼 **회의체가 정한 총량**을
 *   그대로 지시로 만들 방법이 없었고, 이미 집행이 시작된 뒤 소급 등록할 방법도 없었다
 *   (2026-08-20 실사용 리포트 — 8/14 결정, 8/18~8/20 분할 집행 중).
 *
 * 그래서 지시일(결정일)을 **과거로 지정할 수 있다.** 이미 나간 매각을 지시 아래로
 * 모아야 이행률·FIFO 소진·환차손익이 하나의 이력으로 이어진다.
 * 체결은 여기서 하지 않는다 — 등록 후 이행 대기 목록에서 체결 등록으로 진행한다.
 */
export default function FxOrderProposeModal({ company, defaultCurrency, onSubmit, onClose }: {
  company: Company
  defaultCurrency: string
  /** 성공 시 null, 실패 시 에러 메시지 */
  onSubmit: (payload: Record<string, unknown>) => Promise<string | null>
  onClose: () => void
}) {
  const [currency, setCurrency] = useState<FxCode>(
    (FX_CODES as string[]).includes(defaultCurrency) ? defaultCurrency as FxCode : 'USD')
  const [amount, setAmount] = useState('')
  const [orderDate, setOrderDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState(addBizDays(todayStr(), 3))
  const [orderType, setOrderType] = useState<FxOrderType>('discretionary')
  const [sellRate, setSellRate] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fx = useFx()
  const { lots, availableAmount, bookRate, loading: lotsLoading } = useFxLots(company, currency)
  const marketRate = fx.rates.find(r => r.code === currency)?.rate ?? 0

  const amtNum = Number(amount) || 0
  const rateNum = Number(sellRate) || marketRate
  const shortfall = Math.max(0, amtNum - availableAmount)
  const pnl = amtNum && rateNum && bookRate ? (rateNum - bookRate) * amtNum : null

  const dueBeforeOrder = dueDate < orderDate
  const canSubmit = amtNum > 0 && !dueBeforeOrder && !saving

  // 지시일을 바꾸면 기한도 함께 따라오게 한다(사용자가 따로 고칠 수 있음).
  function changeOrderDate(v: string) {
    const prevDefault = addBizDays(orderDate, 3)
    setOrderDate(v)
    if (dueDate === prevDefault) setDueDate(addBizDays(v, 3))
  }

  const backdated = useMemo(() => orderDate < todayStr(), [orderDate])

  async function submit() {
    if (!canSubmit) return
    setSaving(true); setErr(null)
    const rate = rateNum > 0 ? rateNum : null
    const acq = bookRate ?? null
    const error = await onSubmit({
      company,
      trade_date: orderDate,
      currency,
      direction: 'sell',
      amount_fx: amtNum,
      acq_rate: acq,
      trade_rate: rate,
      fx_pnl: acq != null && rate != null ? Math.round((rate - acq) * amtNum) : null,
      amount_krw: rate != null ? Math.round(rate * amtNum) : null,
      memo: memo || `${ORDER_TYPE_LABEL[orderType]} — ${currency} ${amtNum.toLocaleString()} 매각 지시`,
      due_date: dueDate,
      order_type: orderType,
    })
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
          <p className="text-base font-semibold text-gray-800 dark:text-slate-100">➕ 매각 지시 등록</p>
          <p className="text-xs text-gray-400 mt-0.5">
            회의체가 정한 총 매각 물량을 지시 1건으로 등록합니다. 분할 집행은 등록 후 체결로 나눠 기록합니다.
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>통화</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as FxCode)} className={FIELD}>
                {FX_CODES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>지시 수량 ({currency})</label>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                className={`${FIELD} tabular-nums`} placeholder="예: 3000000" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>매도발의일 (지시·결정일)</label>
              <input type="date" value={orderDate} onChange={e => changeOrderDate(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>이행 기한</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={FIELD} />
            </div>
          </div>
          {backdated && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              📌 소급 등록입니다 — 이미 집행된 분은 등록 후 <strong>체결일을 실제 매각일로</strong> 지정해 기록하세요.
            </p>
          )}
          {dueBeforeOrder && <p className="text-xs text-red-600">이행 기한이 지시일보다 빠릅니다.</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>발생 경로</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value as FxOrderType)} className={FIELD}>
                {ORDER_TYPES.map(t => <option key={t} value={t}>{ORDER_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>매도 예정 환율</label>
              <input type="number" step="0.01" value={sellRate} onChange={e => setSellRate(e.target.value)}
                className={`${FIELD} tabular-nums`}
                placeholder={marketRate > 0 ? `${fmtNumber(marketRate, 2)} (현재 시장)` : '미조회'} />
            </div>
          </div>

          <div>
            <label className={LABEL}>사유 · 메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} className={FIELD}
              placeholder="예: 2026-08-14 정책회의 의결 — 환차익 실현 목적 300만불 매각" />
          </div>

          {/* 재고 확인 — 지시 수량이 환전 가능 재고를 넘으면 체결 단계에서 서버가 거부한다.
              지시 등록 자체는 막지 않는다(회의체 결정이 재고보다 앞설 수 있으므로 경고만). */}
          <div className="rounded-lg border border-gray-200 dark:border-slate-600 px-3 py-2 text-xs">
            <p className="font-semibold text-gray-700 dark:text-slate-200">📒 FIFO 재고 확인</p>
            {lotsLoading ? (
              <p className="mt-1 text-gray-400">보유 로트 확인 중…</p>
            ) : lots.length === 0 ? (
              <p className="mt-1 text-gray-400">이 통화의 FIFO 로트가 없습니다 — 체결해도 원장 차감은 일어나지 않습니다.</p>
            ) : (
              <div className="mt-1 space-y-0.5 tabular-nums text-gray-600 dark:text-slate-300">
                <p>환전 가능 재고: {fmtNumber(availableAmount, currency === 'JPY' ? 0 : 2)} {currency}
                  <span className="ml-1 text-gray-400">(정기예금 만기 전 제외)</span></p>
                <p>잔존 장부환율: {bookRate ? `${fmtNumber(bookRate, 2)}원` : '—'}</p>
                {pnl != null && (
                  <p className={pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                    예상 환차{pnl >= 0 ? '익' : '손'}: {pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(pnl))}
                    <span className="ml-1 text-gray-400">(장부환율 기준 · 실제는 체결 시 확정)</span>
                  </p>
                )}
                {shortfall > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    ⚠ 지시 수량이 환전 가능 재고를 {fmtNumber(shortfall, currency === 'JPY' ? 0 : 2)} {currency} 초과합니다.
                  </p>
                )}
              </div>
            )}
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
            취소
          </button>
          <button onClick={submit} disabled={!canSubmit}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '등록 중...' : '지시 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
