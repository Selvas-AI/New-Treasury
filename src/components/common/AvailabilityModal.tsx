import { useState, useEffect } from 'react'

export type AvailItem = {
  key: string
  label: string
  sublabel?: string
  detail?: string
  amount?: number
  current: '가용' | '불가용'
}

type Props = {
  open: boolean
  onClose: () => void
  title: string
  items: AvailItem[]
  onSave: (changes: { key: string; available: '가용' | '불가용' }[]) => Promise<void>
}

export default function AvailabilityModal({ open, onClose, title, items, onSave }: Props) {
  const [state, setState] = useState<Record<string, '가용' | '불가용'>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const init: Record<string, '가용' | '불가용'> = {}
      items.forEach(it => { init[it.key] = it.current })
      setState(init)
    }
  }, [open, items])

  if (!open) return null

  const changes = items.filter(it => state[it.key] !== it.current)

  function setAll(available: '가용' | '불가용') {
    const next: Record<string, '가용' | '불가용'> = {}
    items.forEach(it => { next[it.key] = available })
    setState(next)
  }

  function toggle(key: string) {
    setState(prev => ({ ...prev, [key]: prev[key] === '가용' ? '불가용' : '가용' }))
  }

  async function handleSave() {
    if (changes.length === 0) { onClose(); return }
    setSaving(true)
    await onSave(changes.map(it => ({ key: it.key, available: state[it.key] })))
    setSaving(false)
    onClose()
  }

  const availCount   = items.filter(it => state[it.key] === '가용').length
  const unavailCount = items.filter(it => state[it.key] === '불가용').length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
          <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        {/* 전체 일괄 버튼 */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-slate-700 shrink-0">
          <span className="text-xs text-gray-500 dark:text-slate-400 mr-1">전체</span>
          <button
            onClick={() => setAll('가용')}
            className="text-xs px-3 py-1 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 transition-colors"
          >
            ✓ 전체 가용
          </button>
          <button
            onClick={() => setAll('불가용')}
            className="text-xs px-3 py-1 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 transition-colors"
          >
            ✕ 전체 불가용
          </button>
          <span className="ml-auto text-xs text-gray-400 dark:text-slate-500">
            가용 {availCount} · 불가용 {unavailCount}
          </span>
        </div>

        {/* 목록 */}
        <div className="overflow-y-auto flex-1 px-5 py-2">
          {/* 컬럼 헤더 */}
          <div className="grid grid-cols-[1fr_64px_64px_48px] gap-2 px-1 py-1.5 text-[11px] text-gray-400 dark:text-slate-500 font-medium">
            <span>항목</span>
            <span className="text-center">현재</span>
            <span className="text-center">변경 후</span>
            <span></span>
          </div>
          {items.map(it => {
            const next = state[it.key]
            const changed = next !== it.current
            return (
              <div
                key={it.key}
                className={`grid grid-cols-[1fr_64px_64px_48px] gap-2 items-center px-1 py-2 border-b border-gray-50 dark:border-slate-800 last:border-0 ${changed ? 'bg-blue-50/60 dark:bg-blue-950/20 rounded-lg' : ''}`}
              >
                {/* 항목명 */}
                <div>
                  <p className="text-sm text-gray-800 dark:text-slate-100 leading-tight">{it.label}</p>
                  {it.sublabel && <p className="text-[11px] text-gray-400 dark:text-slate-500">{it.sublabel}</p>}
                  {it.detail   && <p className="text-[11px] text-gray-400 dark:text-slate-500">{it.detail}</p>}
                </div>
                {/* 현재 */}
                <div className="text-center">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${it.current === '가용' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                    {it.current}
                  </span>
                </div>
                {/* 변경 후 */}
                <div className="text-center">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${next === '가용' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                    {next}
                  </span>
                </div>
                {/* 토글 */}
                <div className="flex justify-end">
                  <button
                    onClick={() => toggle(it.key)}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none ${next === '가용' ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-600'}`}
                    aria-label={`${it.label} ${next === '가용' ? '불가용으로 변경' : '가용으로 변경'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${next === '가용' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 dark:border-slate-700 shrink-0">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            {changes.length > 0 ? <span className="text-blue-600 dark:text-blue-400 font-medium">{changes.length}건 변경 예정</span> : '변경 없음'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '저장 중...' : `저장${changes.length > 0 ? ` (${changes.length}건)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
