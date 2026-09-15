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
import { useMemo, useState } from 'react'
import type { InvestmentRecord } from '../../types'
import type { FxLot } from '../../lib/fxLots'
import { isFxTermDeposit, planRolloverLedger, termStateAt, isPlanError } from '../../lib/fxTermSettle'

export interface RolloverValues {
  closeDate: string
  newMaturity: string
  newAmount: number
  newRate: number
  /**
   * 외화 정기예금일 때 — 외화거래명세(원장)에도 해지·재예치를 함께 반영할지.
   * ⚠ 두 장부(investments / fx_lots)는 같은 예금을 각자 기록한다. 한쪽만 처리하면
   *   원장에 만기 지난 정기예금이 남아 환전 가능액이 과소 계산된다.
   */
  syncLedger?: boolean
  /** 이자 재예치분의 장부환율(해지일 환율). syncLedger + 증액일 때만 쓰인다 */
  interestRate?: number
}

export default function RolloverModal({ record, busy, ledgerLots, ledgerLoading, defaultRate, onCancel, onConfirm }: {
  record: InvestmentRecord
  busy?: boolean
  /** 이 법인·통화의 원장 로트. 외화 정기예금일 때만 전달된다 */
  ledgerLots?: FxLot[] | null
  ledgerLoading?: boolean
  /** 이자 장부환율 기본값 = 현재 시세 */
  defaultRate?: number
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
  const interest = newAmount - (record.amount ?? 0)

  // ── 외화 원장 연동 ────────────────────────────────────────────────────────
  const ledgerEligible = isFxTermDeposit(record)
  const [syncLedger,   setSyncLedger]   = useState(true)
  const [interestRateStr, setInterestRateStr] = useState('')
  const interestRate = Number(interestRateStr) || defaultRate || 0

  // 계산은 순수 함수 하나에만 둔다(lib/fxTermSettle.ts) — 화면에서 다시 만들면 갈라진다.
  const ledgerPlan = useMemo(() => {
    if (!ledgerEligible || !ledgerLots) return null
    return planRolloverLedger(record, { closeDate, newMaturity, newAmount, newRate },
      termStateAt(ledgerLots, closeDate))
  }, [ledgerEligible, ledgerLots, record, closeDate, newMaturity, newAmount, newRate])

  const ledgerBlocked = !!ledgerPlan && isPlanError(ledgerPlan)
  const needsRate = !!ledgerPlan && !isPlanError(ledgerPlan) && ledgerPlan.plan.interest > 0
  const rateMissing = syncLedger && needsRate && !(interestRate > 0)

  const invalid =
    !closeDate || !newMaturity || newMaturity <= closeDate || newAmount <= 0
    || (syncLedger && ledgerBlocked) || rateMissing

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

        {/* 외화 원장 연동 — 같은 사실을 두 장부에 두 번 넣지 않게 한다.
            ⚠ 여기서 끄면 외화거래명세 › 데이터 등록에서 **직접 해지**해야 한다. */}
        {ledgerEligible && (
          <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={syncLedger} onChange={e => setSyncLedger(e.target.checked)}
                className="mt-0.5" disabled={ledgerLoading} />
              <span className="text-xs font-medium text-gray-700 dark:text-slate-200">
                외화거래명세(원장)에도 해지·재예치를 함께 반영
                <span className="block text-[10px] font-normal text-gray-500 dark:text-slate-400">
                  끄면 외화거래명세 › 데이터 등록 › 정기예금 관리에서 따로 해지해야 합니다.
                </span>
              </span>
            </label>

            {ledgerLoading && <p className="text-[11px] text-gray-400">원장 잔액 확인 중…</p>}

            {syncLedger && ledgerPlan && isPlanError(ledgerPlan) && (
              <p className="text-[11px] text-red-600 dark:text-red-400 break-keep">⚠ {ledgerPlan.error}</p>
            )}

            {syncLedger && ledgerPlan && !isPlanError(ledgerPlan) && (
              <>
                {needsRate && (
                  <Field label={`이자 장부환율 (${record.currency} 해지일 환율)`}
                    hint="이자는 새로 생긴 외화라 원금 장부환율이 아니라 해지일 환율로 잡아야 원가가 왜곡되지 않습니다.">
                    <input type="text" inputMode="decimal"
                      value={interestRateStr} placeholder={defaultRate ? String(Math.round(defaultRate * 100) / 100) : ''}
                      onChange={e => setInterestRateStr(e.target.value)} className={inputCls} />
                  </Field>
                )}
                <ul className="text-[11px] text-gray-600 dark:text-slate-300 space-y-0.5">
                  <li>· 원금 {fmt(ledgerPlan.plan.principal)} → 정기예금 대체 (장부환율 승계, 손익 0)</li>
                  {ledgerPlan.plan.interest > 0 && (
                    <li>· 이자 {fmt(ledgerPlan.plan.interest)} → 정기예금 신규 로트 @{interestRate ? interestRate.toLocaleString() : '?'}</li>
                  )}
                  {ledgerPlan.plan.allowEarly && (
                    <li className="text-amber-600 dark:text-amber-400">· 만기 도래분이 부족해 <strong>중도해지</strong>로 처리됩니다</li>
                  )}
                </ul>
                {ledgerPlan.warning && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 break-keep">⚠ {ledgerPlan.warning}</p>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel}
            className="flex-1 text-sm py-2 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">
            취소
          </button>
          <button
            onClick={() => onConfirm({ closeDate, newMaturity, newAmount, newRate,
              syncLedger: ledgerEligible && syncLedger, interestRate })}
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
