/**
 * WeekCashflowModal — 12주 포캐스트 특정 주×방향(입금/출금)의 항목별 상세 입력
 * 자금일보 ItemsSection과 동일하게 카테고리+금액+메모 단위로 관리한다.
 */
import { useState } from 'react'
import { IN_CATEGORIES, OUT_CATEGORIES } from '../../lib/dailyReportCategories'
import { fmtKRW } from '../../lib/format'
import type { CashflowPlanItem } from '../../hooks/useCashflowPlan'

// 평가손익(투자자산평가)은 자금일보 자동생성 전용 — 계획 입력 대상에서 제외
const PLAN_IN_CATEGORIES  = IN_CATEGORIES.filter(c => c.code !== 'invest_eval_in')
const PLAN_OUT_CATEGORIES = OUT_CATEGORIES.filter(c => c.code !== 'invest_eval_out')

interface Props {
  weekLabel:  string   // "이번 주 (7/1~)" 형태
  direction:  'in' | 'out'
  items:      CashflowPlanItem[]
  readOnly:   boolean
  onClose:    () => void
  onAdd:      (category: string, amount: number, memo: string) => Promise<string | null>
  onUpdate:   (id: string, patch: { category?: string; amount?: number; memo?: string }) => Promise<string | null>
  onRemove:   (id: string) => Promise<string | null>
}

export default function WeekCashflowModal({
  weekLabel, direction, items, readOnly, onClose, onAdd, onUpdate, onRemove,
}: Props) {
  const categories = direction === 'in' ? PLAN_IN_CATEGORIES : PLAN_OUT_CATEGORIES
  const [category, setCategory] = useState(categories[0]?.code ?? '')
  const [amount,   setAmount]   = useState('')
  const [memo,     setMemo]     = useState('')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState<string | null>(null)
  const [editId,   setEditId]   = useState<string | null>(null)

  const total = items.reduce((s, i) => s + i.amount, 0)
  const label = direction === 'in' ? '입금' : '출금'
  const accent = direction === 'in' ? 'blue' : 'red'

  async function handleAdd() {
    const amt = (parseFloat(amount) || 0) * 1e8
    if (!amt || amt <= 0) { setErr('금액을 입력하세요.'); return }
    setSaving(true); setErr(null)
    const e = await onAdd(category, amt, memo)
    setSaving(false)
    if (e) { setErr(e); return }
    setAmount(''); setMemo('')
  }

  async function handleDelete(id: string) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return
    const e = await onRemove(id)
    if (e) setErr(e)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm">{weekLabel} · {label} 상세</h3>
            <p className={`text-xs mt-0.5 font-medium ${accent === 'blue' ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
              합계 {fmtKRW(total)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        {/* 입력 폼 */}
        {!readOnly && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 shrink-0 space-y-2">
            <div className="flex gap-2">
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="flex-1 text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-gray-800 dark:text-white">
                {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <input type="number" step="0.1" placeholder="금액(억원)" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-28 text-xs text-right border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-gray-800 dark:text-white" />
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder="메모 (선택)" value={memo}
                onChange={e => setMemo(e.target.value)}
                className="flex-1 text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-gray-800 dark:text-white" />
              <button onClick={handleAdd} disabled={saving}
                className={`text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50 ${accent === 'blue' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}>
                {saving ? '저장 중…' : '+ 추가'}
              </button>
            </div>
            {err && <p className="text-[11px] text-red-500">{err}</p>}
          </div>
        )}

        {/* 항목 목록 */}
        <div className="overflow-y-auto flex-1 px-5 py-2">
          {items.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">입력된 항목이 없습니다.</p>
          ) : items.map(item => {
            const cat = categories.find(c => c.code === item.category)
            const isEditing = editId === item.id
            return (
              <div key={item.id} className="flex items-center gap-2 px-1 py-2 border-b border-gray-50 dark:border-slate-800 last:border-0">
                {isEditing ? (
                  <ItemEditRow
                    item={item} categories={categories}
                    onCancel={() => setEditId(null)}
                    onSave={async patch => { const e = await onUpdate(item.id, patch); if (e) setErr(e); else setEditId(null) }}
                  />
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 dark:text-slate-100">{cat?.label ?? item.category}</p>
                      {item.memo && <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{item.memo}</p>}
                    </div>
                    <span className={`text-xs font-medium tabular-nums ${accent === 'blue' ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                      {fmtKRW(item.amount)}
                    </span>
                    {!readOnly && (
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => setEditId(item.id)} className="text-[11px] text-gray-400 hover:text-blue-500">수정</button>
                        <button onClick={() => handleDelete(item.id)} className="text-[11px] text-gray-400 hover:text-red-500">삭제</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end px-5 py-3 border-t border-gray-100 dark:border-slate-700 shrink-0">
          <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function ItemEditRow({ item, categories, onCancel, onSave }: {
  item: CashflowPlanItem
  categories: { code: string; label: string }[]
  onCancel: () => void
  onSave: (patch: { category: string; amount: number; memo: string }) => void
}) {
  const [category, setCategory] = useState(item.category)
  const [amount,   setAmount]   = useState(String(item.amount / 1e8))
  const [memo,     setMemo]     = useState(item.memo)

  return (
    <div className="flex-1 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="flex-1 text-xs border border-blue-300 dark:border-blue-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-white">
          {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <input type="number" step="0.1" value={amount} onChange={e => setAmount(e.target.value)}
          className="w-20 text-xs text-right border border-blue-300 dark:border-blue-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-white" />
      </div>
      <div className="flex gap-1.5">
        <input type="text" placeholder="메모" value={memo} onChange={e => setMemo(e.target.value)}
          className="flex-1 text-xs border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-white" />
        <button onClick={() => onSave({ category, amount: (parseFloat(amount) || 0) * 1e8, memo })}
          className="text-[11px] bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">저장</button>
        <button onClick={onCancel} className="text-[11px] text-gray-400 px-1.5 py-1">취소</button>
      </div>
    </div>
  )
}
