/**
 * InvestReturnPopup — 투자금 회수 연동 팝업
 * 운용자금(investments) 또는 지분(equities) 선택 후 회수금액 저장
 * 선택한 운용자금은 active=false 처리 (지분은 금액만 기록)
 */
import { useState, useEffect } from 'react'
import { supabase, restUpdate } from '../../lib/supabase'
import type { Company, InvestmentRecord, EquityRecord } from '../../types'

interface Props {
  company:  Company
  reportDate: string         // 보고대상일 (데이터 기준일)
  onSaved:  (amount: number, currency: string, memo: string, linkedType: string, linkedId: string) => Promise<void>
  onClose:  () => void
}

type Tab = 'invest' | 'equity'

function fmtKRW(n: number) {
  return Math.round(n).toLocaleString('ko-KR') + '원'
}

export default function InvestReturnPopup({ company, reportDate, onSaved, onClose }: Props) {
  const [tab,       setTab]       = useState<Tab>('invest')
  const [invests,   setInvests]   = useState<InvestmentRecord[]>([])
  const [equities,  setEquities]  = useState<EquityRecord[]>([])
  const [selectedId, setSelected] = useState<string | null>(null)
  const [amtStr,    setAmtStr]    = useState('')
  const [memo,      setMemo]      = useState('')
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('investments').select('*').eq('company', company).eq('active', true).neq('product', '국채'),
      supabase.from('equities').select('*').eq('company', company).lte('date', reportDate).order('date', { ascending: false }),
    ]).then(([iRes, eRes]) => {
      setInvests((iRes.data ?? []) as InvestmentRecord[])
      // 지분: 종목별 최신 레코드만
      const seen = new Set<string>()
      const latest: EquityRecord[] = []
      for (const r of (eRes.data ?? []) as EquityRecord[]) {
        if (!seen.has(r.name)) { seen.add(r.name); latest.push(r) }
      }
      setEquities(latest)
      setLoading(false)
    })
  }, [company, reportDate])

  const list = tab === 'invest' ? invests : equities

  function handleSelect(id: string) {
    setSelected(id)
    const def = getDefaultAmountById(id)
    setAmtStr(def > 0 ? Math.round(def).toLocaleString('ko-KR') : '')
  }

  function getDefaultAmountById(id: string): number {
    if (tab === 'invest') {
      return invests.find(i => i.id === id)?.amount ?? 0
    }
    return equities.find(e => e.id === id)?.total_value ?? 0
  }

  async function handleSave() {
    if (!selectedId) { setError('항목을 선택하세요'); return }
    const amount = Number(amtStr.replace(/,/g, '')) || 0
    if (amount <= 0) { setError('회수 금액을 입력하세요'); return }
    setSaving(true)
    setError(null)
    try {
      // 운용자금 → active = false 처리
      if (tab === 'invest') {
        const { error: e } = await restUpdate('investments', { active: false }, { id: selectedId })
        if (e) throw new Error(e.message)
      }
      const inv  = invests.find(i => i.id === selectedId)
      const eq   = equities.find(e => e.id === selectedId)
      const label = tab === 'invest'
        ? `${inv?.bank ?? ''} ${inv?.product ?? ''} 회수`
        : `${eq?.name ?? ''} 지분 회수`
      await onSaved(amount, 'KRW', memo || label, tab === 'invest' ? 'investment' : 'equity', selectedId)
      onClose()
    } catch (e) {
      setError(String(e))
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]" style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">💰 투자금 회수 연동</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">회수할 항목을 선택하고 회수금액을 입력하세요</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
        </div>

        {/* 탭 */}
        <div className="px-6 pt-3 flex gap-2 shrink-0">
          {(['invest', 'equity'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setSelected(null); setAmtStr('') }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              {t === 'invest' ? '운용자금' : '지분·장기투자'}
            </button>
          ))}
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="text-center py-8 text-xs text-gray-400 animate-pulse">불러오는 중…</div>
          ) : list.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400">활성 항목이 없습니다</div>
          ) : (
            <div className="space-y-1.5">
              {tab === 'invest' ? invests.map(inv => (
                <button key={inv.id} onClick={() => handleSelect(inv.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedId === inv.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-700'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{inv.bank}</span>
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{inv.product}</span>
                    </div>
                    <span className="text-xs font-bold text-blue-600 tabular-nums">{fmtKRW(inv.amount)}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">만기 {inv.maturity} · 금리 {inv.rate}%</div>
                </button>
              )) : equities.map(eq => (
                <button key={eq.id} onClick={() => handleSelect(eq.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedId === eq.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-700'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{eq.name}</span>
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{eq.market}</span>
                    </div>
                    <span className="text-xs font-bold text-blue-600 tabular-nums">{fmtKRW(eq.total_value)}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{eq.shares.toLocaleString()}주 · {eq.date} 기준</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 금액 입력 + 저장 */}
        {selectedId && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 space-y-3 shrink-0">
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">회수금액</label>
              <input type="text" inputMode="numeric" value={amtStr}
                onChange={e => setAmtStr(e.target.value.replace(/[^\d,]/g, ''))}
                placeholder="금액 (원)"
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-16 shrink-0">메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            {tab === 'invest' && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">⚠ 저장 시 해당 운용자금을 만기처리(비활성)합니다</p>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">취소</button>
              <button onClick={() => void handleSave()} disabled={saving}
                className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700">
                {saving ? '저장 중…' : '💰 회수 등록'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
