/**
 * 정기예금 연장(rollover) 모달 (2026-09-09)
 *
 * ⭐ 연장을 "기존 건 수정"으로 처리하면 개시일·만기일이 덮어써져 **과거가 지워진다.**
 *   그러면 6월 잔액을 재구성할 때 그 예금이 통째로 사라진다(실사례).
 *   그래서 이 화면은 **기존 건을 만기 종료하고 새 건을 만든다** — 과거가 구조적으로 남는다.
 *
 * ⚠ window.confirm 을 쓰지 않는다. 크롬이 반복 대화상자를 차단하면 즉시 false 를 반환해
 *   "눌러도 아무 일이 없는" 상태가 된다(세션24차 실사고).
 */
import { useState } from 'react'
import type { InvestmentRecord } from '../../types'

export interface RolloverValues {
  closeDate: string
  newMaturity: string
  newAmount: number
  newRate: number
}

export default function RolloverModal({ record, busy, onCancel, onConfirm }: {
  record: InvestmentRecord
  busy?: boolean
  onCancel: () => void
  onConfirm: (v: RolloverValues) => void
}) {
  const isFx = record.currency && record.currency !== 'KRW'
  // 종료일 기본값 = 기존 만기일. 그날 새 예금이 개시되는 것이 일반적이다.
  const [closeDate,   setCloseDate]   = useState(record.maturity || '')
  const [newMaturity, setNewMaturity] = useState('')
  const [amountStr,   setAmountStr]   = useState(String(record.amount ?? 0))
  const [rateStr,     setRateStr]     = useState(String(record.rate ?? 0))

  const newAmount = Number(amountStr.replace(/,/g, '')) || 0
  const newRate   = Number(rateStr) || 0
  const invalid =
    !closeDate || !newMaturity || newMaturity <= closeDate || newAmount <= 0
  const interest = newAmount - (record.amount ?? 0)

  const fmt = (n: number) =>
    `${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${isFx ? ' ' + record.currency : '원'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
        onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">정기예금 연장</h3>
        <p className="text-xs text-gray-500 dark:text-slate-300 mb-1">
          {record.bank} · {record.product} · {fmt(record.amount ?? 0)}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-4">
          기존 건을 <strong>종료 처리</strong>하고 새 건을 만듭니다. 과거 잔액이 그대로 보존되고
          변경 이력에도 남습니다.
        </p>

        <div className="space-y-3">
          <Field label="기존 건 종료일 (= 새 건 개시일)"
            hint="보통 기존 만기일입니다. 이 날짜까지는 기존 예금이 잔액에 잡힙니다.">
            <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)}
              className={inputCls} />
          </Field>

          <Field label="새 만기일">
            <input type="date" value={newMaturity} onChange={e => setNewMaturity(e.target.value)}
              className={inputCls} />
            {newMaturity !== '' && newMaturity <= closeDate && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                새 만기일은 개시일보다 뒤여야 합니다.
              </p>
            )}
          </Field>

          <Field label={`연장 금액 (${isFx ? record.currency : '원'})`}
            hint="이자를 더해 재예치하면 그만큼 늘려 입력하세요.">
            <input type="text" inputMode="decimal" value={amountStr}
              onChange={e => setAmountStr(e.target.value)} className={inputCls} />
            {interest !== 0 && (
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                기존 대비 {interest > 0 ? '+' : '−'}{fmt(Math.abs(interest))}
                {interest > 0 && ' (이자 재예치로 처리됩니다)'}
              </p>
            )}
          </Field>

          <Field label="연이율 (%)">
            <input type="text" inputMode="decimal" value={rateStr}
              onChange={e => setRateStr(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-slate-900/50 p-3 text-[11px] text-gray-500 dark:text-slate-400 space-y-0.5">
          <div>· 기존 건 — {record.start || '?'} ~ <strong>{closeDate || '?'}</strong> 종료 처리</div>
          <div>· 새 건 — <strong>{closeDate || '?'}</strong> ~ {newMaturity || '?'} · {fmt(newAmount)}</div>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel}
            className="flex-1 text-sm py-2 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">
            취소
          </button>
          <button
            onClick={() => onConfirm({ closeDate, newMaturity, newAmount, newRate })}
            disabled={invalid || busy}
            className="flex-1 text-sm py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium disabled:opacity-50">
            {busy ? '처리 중…' : '연장 처리'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 ' +
  'bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400'

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{hint}</p>}
    </div>
  )
}
