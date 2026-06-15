/**
 * LoanRepaymentPopup — 차입금 상환 연동 팝업
 * 활성 차입금 선택 → loans.active=false 처리 + 일보 아이템 저장
 */
import { useState, useEffect } from 'react'
import { supabase, restUpdate } from '../../lib/supabase'
import type { Company, LoanRecord } from '../../types'

interface Props {
  company:  Company
  onSaved:  (amount: number, currency: string, memo: string, linkedType: string, linkedId: string) => Promise<void>
  onClose:  () => void
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  단기: '단기차입금', 장기: '장기차입금', 운전: '운전자금', 시설: '시설자금',
}

export default function LoanRepaymentPopup({ company, onSaved, onClose }: Props) {
  const [loans,      setLoans]      = useState<LoanRecord[]>([])
  const [selectedId, setSelected]   = useState<string | null>(null)
  const [amtStr,     setAmtStr]     = useState('')
  const [memo,       setMemo]       = useState('')
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    supabase.from('loans').select('*').eq('company', company).eq('active', true)
      .order('maturity', { ascending: true })
      .then(({ data }) => { setLoans((data ?? []) as LoanRecord[]); setLoading(false) })
  }, [company])

  function handleSelect(loan: LoanRecord) {
    setSelected(loan.id)
    setAmtStr(Math.round(loan.amount).toLocaleString('ko-KR'))
    setMemo(`${loan.lender} 차입금 상환`)
  }

  async function handleSave() {
    if (!selectedId) { setError('차입금을 선택하세요'); return }
    const amount = Number(amtStr.replace(/,/g, '')) || 0
    if (amount <= 0) { setError('상환 금액을 입력하세요'); return }
    setSaving(true)
    setError(null)
    try {
      const { error: e } = await restUpdate('loans', { active: false }, { id: selectedId })
      if (e) throw new Error(e.message)
      await onSaved(amount, 'KRW', memo, 'loan', selectedId)
      onClose()
    } catch (e) {
      setError(String(e))
    }
    setSaving(false)
  }

  const selected = loans.find(l => l.id === selectedId)

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
                return (
                  <button key={loan.id} onClick={() => handleSelect(loan)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedId === loan.id ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-100 dark:border-slate-700 hover:border-red-200 dark:hover:border-red-700'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{loan.lender}</span>
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-500">
                          {LOAN_TYPE_LABELS[loan.type] ?? loan.type}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-red-500 tabular-nums">
                        {Math.round(loan.amount).toLocaleString('ko-KR')}원
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
        {selectedId && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 space-y-3 shrink-0">
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">상환금액</label>
              <input type="text" inputMode="numeric" value={amtStr}
                onChange={e => setAmtStr(e.target.value.replace(/[^\d,]/g, ''))}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-red-400" />
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-red-400" />
            </div>
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              ⚠ 저장 시 해당 차입금을 상환처리(비활성)합니다 — {selected?.lender} {selected?.amount.toLocaleString()}원
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">취소</button>
              <button onClick={() => void handleSave()} disabled={saving}
                className="text-xs px-4 py-1.5 bg-red-500 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-red-600">
                {saving ? '저장 중…' : '🏦 상환 처리'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

