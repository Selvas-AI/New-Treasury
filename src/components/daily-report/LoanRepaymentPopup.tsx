/**
 * LoanRepaymentPopup — 차입금 상환 연동 팝업
 *
 * 활성 차입금 선택 → loans 상환 처리 + 자금일보 출금 항목 저장
 *
 * ⚠ 통화는 **선택한 차입금의 통화**를 그대로 따른다. 과거 'KRW' 하드코딩 때문에
 *   JPY 차입금을 상환하면 일보 항목이 "13,392,000 KRW" 로 기록돼 실제 1.2억원대
 *   출금이 1,339만원으로 잡혔다(2026-11-06 리포트). 통화를 임의로 바꿀 수 없게
 *   선택지로 두지 않고 원천 레코드에서 읽는다 — 차입금 통화와 상환 통화가
 *   다를 수 없기 때문이다.
 *
 * ⚠ 상환 처리는 useLoans.setActive 와 **같은 규약**을 지킨다 —
 *   closed_date 를 반드시 기록한다. 없으면 상환 이후 과거 잔액이 전부 소급
 *   차감돼 보인다(세션19차 Task 5·6, 세션27차 point-in-time 재구성).
 */
import { useState, useEffect } from 'react'
import { supabase, restUpdate } from '../../lib/supabase'
import { useAuditLog } from '../../hooks/useAuditLog'
import type { Company, LoanRecord } from '../../types'

interface Props {
  company:  Company
  /** 보고대상일 — 실제 상환일 기본값 */
  reportDate: string
  onSaved:  (amount: number, currency: string, memo: string, linkedType: string, linkedId: string) => Promise<void>
  onClose:  () => void
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  단기: '단기차입금', 장기: '장기차입금', 운전: '운전자금', 시설: '시설자금',
}

/** 통화 단위를 붙인 금액 — 원화만 '원', 나머지는 통화코드 */
function fmtAmt(n: number, currency: string): string {
  const v = Math.round(n).toLocaleString('ko-KR')
  return currency === 'KRW' ? `${v}원` : `${v} ${currency}`
}

export default function LoanRepaymentPopup({ company, reportDate, onSaved, onClose }: Props) {
  const { logAction } = useAuditLog()
  const [loans,      setLoans]      = useState<LoanRecord[]>([])
  const [selectedId, setSelected]   = useState<string | null>(null)
  const [amtStr,     setAmtStr]     = useState('')
  const [memo,       setMemo]       = useState('')
  const [mode,       setMode]       = useState<'full' | 'partial'>('full')
  const [closeDate,  setCloseDate]  = useState(reportDate)
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    supabase.from('loans').select('*').eq('company', company).eq('active', true)
      .order('maturity', { ascending: true })
      .then(({ data }) => { setLoans((data ?? []) as LoanRecord[]); setLoading(false) })
  }, [company])

  const selected = loans.find(l => l.id === selectedId) ?? null
  // 통화는 원천 레코드가 정본 — 사용자가 고르지 않는다
  const currency = selected?.currency || 'KRW'
  const amount   = Number(amtStr.replace(/,/g, '')) || 0
  const remain   = selected ? selected.amount - amount : 0

  function handleSelect(loan: LoanRecord) {
    setSelected(loan.id)
    setAmtStr(Math.round(loan.amount).toLocaleString('ko-KR'))
    setMemo(`${loan.lender} 차입금 상환`)
    setMode('full')
    setError(null)
  }

  // 전액/일부 전환 시 금액을 맞춰준다 — 전액인데 금액이 다르면 모순이다
  function switchMode(next: 'full' | 'partial') {
    setMode(next)
    if (next === 'full' && selected) setAmtStr(Math.round(selected.amount).toLocaleString('ko-KR'))
  }

  async function handleSave() {
    if (!selected) { setError('차입금을 선택하세요'); return }
    if (amount <= 0) { setError('상환 금액을 입력하세요'); return }
    if (mode === 'partial' && amount >= selected.amount) {
      setError(`일부 상환 금액은 잔액(${fmtAmt(selected.amount, currency)})보다 적어야 합니다. 전액 상환이라면 위에서 '전액'을 선택하세요.`)
      return
    }
    if (mode === 'full' && amount !== Math.round(selected.amount)) {
      setError(`전액 상환은 잔액 ${fmtAmt(selected.amount, currency)} 과 같아야 합니다. 금액을 고치셨다면 '일부 상환'을 선택하세요.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'full') {
        // ⚠ closed_date 필수 — 없으면 과거 잔액이 소급 차감돼 보인다.
        //   실제 상환일과 처리일이 다를 수 있어 화면에서 받는다.
        const { error: e } = await restUpdate('loans',
          { active: false, closed_date: closeDate }, { id: selected.id })
        if (e) throw new Error(e.message)
        await logAction({
          table: 'loans', action: 'SETACTIVE', company, recordId: selected.id,
          summary: `${selected.lender} ${fmtAmt(selected.amount, currency)} 상환처리 (자금일보 연동)`,
          before: { ...selected },
          after:  { ...selected, active: false, closed_date: closeDate },
        })
      } else {
        // 분할 상환 — 차입금은 유지하고 잔액만 줄인다.
        //   별도 상환 원장이 없는 스키마라 원금 차감이 유일한 표현 방식이다.
        const next = selected.amount - amount
        const { error: e } = await restUpdate('loans', { amount: next }, { id: selected.id })
        if (e) throw new Error(e.message)
        await logAction({
          table: 'loans', action: 'UPDATE', company, recordId: selected.id,
          summary: `${selected.lender} ${fmtAmt(amount, currency)} 일부 상환 — 잔액 ${fmtAmt(next, currency)} (자금일보 연동)`,
          before: { ...selected },
          after:  { ...selected, amount: next },
        })
      }
      await onSaved(amount, currency, memo, 'loan', selected.id)
      onClose()
    } catch (e) {
      setError(String(e))
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]" style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">🏦 차입금 상환 연동</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">상환할 차입금을 선택하세요</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="text-center py-8 text-xs text-gray-400 animate-pulse">불러오는 중…</div>
          ) : loans.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400">활성 차입금이 없습니다</div>
          ) : (
            <div className="space-y-1.5">
              {loans.map(loan => {
                const dday = Math.ceil((new Date(loan.maturity).getTime() - Date.now()) / 86400000)
                const cur  = loan.currency || 'KRW'
                return (
                  <button key={loan.id} onClick={() => handleSelect(loan)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedId === loan.id ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-700'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{loan.lender}</span>
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-500">
                          {LOAN_TYPE_LABELS[loan.type] ?? loan.type}
                        </span>
                        {cur !== 'KRW' && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                            {cur}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-red-500 tabular-nums">
                        {fmtAmt(loan.amount, cur)}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 flex gap-3">
                      <span>금리 {loan.rate}%</span>
                      <span>만기 {loan.maturity}</span>
                      <span className={dday < 0 ? 'text-red-400' : dday <= 30 ? 'text-amber-400' : ''}>
                        {dday < 0 ? `만기경과 D+${Math.abs(dday)}` : `D-${dday}`}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 금액 입력 + 저장 */}
        {selected && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 space-y-3 shrink-0">
            {/* 상환 구분 — 금액을 고쳐도 무조건 전액 종료되던 문제를 명시적 선택으로 바꾼다 */}
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">상환 구분</label>
              <div className="flex gap-1.5">
                {([['full', '전액 상환'], ['partial', '일부 상환']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => switchMode(k)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                      mode === k
                        ? 'bg-red-500 border-red-500 text-white'
                        : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-red-300'
                    }`}>{label}</button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">상환금액</label>
              <input type="text" inputMode="numeric" value={amtStr}
                onChange={e => {
                  const raw = e.target.value.replace(/,/g, '').replace(/[^\d]/g, '')
                  const n = parseInt(raw, 10)
                  setAmtStr(raw === '' ? '' : n.toLocaleString('ko-KR'))
                }}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-red-400" />
              {/* 통화는 차입금에서 따라오며 바꿀 수 없다 */}
              <span className="text-xs font-semibold text-gray-500 dark:text-slate-300 w-10 shrink-0" title="차입금에 등록된 통화입니다 — 상환 통화는 따로 고를 수 없습니다">
                {currency}
              </span>
            </div>

            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0" title="실제로 상환이 일어난 날입니다. 처리일과 다를 수 있어 직접 지정합니다.">
                {mode === 'full' ? '상환일' : '처리일'}
              </label>
              <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)}
                disabled={mode === 'partial'}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400 disabled:opacity-40" />
            </div>

            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
            </div>

            <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
              {mode === 'full' ? (
                <>⚠ 저장 시 <b>{selected.lender} {fmtAmt(selected.amount, currency)}</b> 차입금을 상환처리(비활성)합니다 — 상환일 {closeDate}</>
              ) : (
                <>⚠ 저장 시 차입금은 <b>유지</b>되고 잔액이 <b>{fmtAmt(selected.amount, currency)} → {fmtAmt(remain > 0 ? remain : 0, currency)}</b> 로 줄어듭니다</>
              )}
              {currency !== 'KRW' && (
                <><br />💱 {currency} 차입금입니다 — 일보에는 <b>{currency} 원금</b>으로 기록되고 원화 환산은 현재 시세로 계산됩니다.</>
              )}
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">취소</button>
              <button onClick={() => void handleSave()} disabled={saving}
                className="text-xs px-4 py-1.5 bg-red-500 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-red-600">
                {saving ? '저장 중…' : mode === 'full' ? '🏦 상환 처리' : '🏦 일부 상환'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
