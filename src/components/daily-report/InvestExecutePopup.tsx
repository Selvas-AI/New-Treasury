/**
 * InvestExecutePopup — 투자 집행 연동 팝업
 * 신규 운용자금 입력 → investments 테이블 insert + 일보 아이템 저장
 */
import { useState } from 'react'
import { restInsert } from '../../lib/supabase'
import { generateUUID } from '../../lib/format'
import { todayStr } from '../../lib/bizDay'
import type { Company } from '../../types'

interface Props {
  company:  Company
  onSaved:  (amount: number, currency: string, memo: string, linkedType: string, linkedId: string) => Promise<void>
  onClose:  () => void
}

const PRODUCTS = ['정기예금', 'MMF', 'RP', 'CP', '전자단기사채', '기타']

export default function InvestExecutePopup({ company, onSaved, onClose }: Props) {
  const today = todayStr()
  const [form, setForm] = useState({
    bank:     '',
    product:  '정기예금',
    currency: 'KRW',
    amtStr:   '',
    rate:     '',
    start:    today,
    maturity: '',
    memo:     '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave() {
    const amount = Number(form.amtStr.replace(/,/g, '')) || 0
    if (!form.bank.trim()) { setError('금융기관명을 입력하세요'); return }
    if (amount <= 0) { setError('투자금액을 입력하세요'); return }
    if (!form.maturity) { setError('만기일을 입력하세요'); return }
    setSaving(true)
    setError(null)
    try {
      const newId = generateUUID()
      const { error: e } = await restInsert('investments', {
        id:       newId,
        company,
        bank:     form.bank.trim(),
        product:  form.product,
        currency: form.currency,
        amount,
        rate:     Number(form.rate) || 0,
        start:    form.start,
        maturity: form.maturity,
        active:   true,
      })
      if (e) throw new Error(e.message)
      const memo = form.memo.trim() || `${form.bank} ${form.product} 투자집행`
      await onSaved(amount, form.currency, memo, 'investment', newId)
      onClose()
    } catch (e) {
      setError(String(e))
    }
    setSaving(false)
  }

  const inputCls = 'text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full'
  const labelCls = 'text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col" style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📈 투자 집행 연동</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">신규 운용자금을 등록하고 일보에 자동 연동합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
        </div>

        {/* 폼 */}
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className={labelCls}>금융기관 <span className="text-red-400">*</span></span>
            <input type="text" value={form.bank} onChange={e => set('bank', e.target.value)}
              placeholder="예: 국민은행" className={inputCls} />
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>상품 유형</span>
            <select value={form.product} onChange={e => set('product', e.target.value)} className={inputCls}>
              {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>금액 <span className="text-red-400">*</span></span>
            <input type="text" inputMode="numeric" value={form.amtStr}
              onChange={e => set('amtStr', e.target.value.replace(/[^\d,]/g, ''))}
              placeholder="투자금액" className={inputCls + ' text-right tabular-nums'} />
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>통화</span>
            <select value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
              {['KRW', 'USD', 'EUR', 'JPY'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>금리 (%)</span>
            <input type="text" inputMode="decimal" value={form.rate}
              onChange={e => set('rate', e.target.value)}
              placeholder="예: 3.8" className={inputCls} />
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>시작일 <span className="text-red-400">*</span></span>
            <input type="date" value={form.start} onChange={e => set('start', e.target.value)} className={inputCls} />
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>만기일 <span className="text-red-400">*</span></span>
            <input type="date" value={form.maturity} onChange={e => set('maturity', e.target.value)} className={inputCls} />
          </div>
          <div className="flex items-center gap-3">
            <span className={labelCls}>메모</span>
            <input type="text" value={form.memo} onChange={e => set('memo', e.target.value)}
              placeholder="메모 (선택)" className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-500 pt-1">{error}</p>}
        </div>

        {/* 저장 */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">취소</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="text-xs px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-indigo-700">
            {saving ? '저장 중…' : '📈 투자 집행 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
