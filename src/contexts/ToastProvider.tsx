/**
 * ToastProvider — 공통 토스트 알림 (C5)
 *
 * 배경: 페이지마다 setError/setSuccess 후 표시 방식이 제각각(인라인 배너, alert 등).
 *   전역 토스트로 성공/실패/안내를 일관되게 노출한다.
 *
 * 사용:
 *   const toast = useToast()
 *   toast.success('저장되었습니다')
 *   toast.error('저장 실패: ...')
 *   toast.info('처리 중...')
 *
 * 특징: 우상단 스택, 자동 소멸(기본 3.5s), 수동 닫기, 다크모드 대응.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem { id: string; type: ToastType; message: string }

interface ToastApi {
  show:    (message: string, type?: ToastType, durationMs?: number) => void
  success: (message: string, durationMs?: number) => void
  error:   (message: string, durationMs?: number) => void
  info:    (message: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLE: Record<ToastType, string> = {
  success: 'bg-emerald-600 text-white',
  error:   'bg-red-600 text-white',
  info:    'bg-slate-800 text-white dark:bg-slate-700',
}
const ICON: Record<ToastType, string> = { success: '✓', error: '⚠', info: 'ℹ' }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Record<string, number>>({})

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id))
    const tid = timers.current[id]
    if (tid) { window.clearTimeout(tid); delete timers.current[id] }
  }, [])

  const show = useCallback((message: string, type: ToastType = 'info', durationMs = 3500) => {
    const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()))
    setItems(prev => [...prev, { id, type, message }])
    timers.current[id] = window.setTimeout(() => dismiss(id), durationMs)
  }, [dismiss])

  const api: ToastApi = {
    show,
    success: useCallback((m: string, d?: number) => show(m, 'success', d), [show]),
    error:   useCallback((m: string, d?: number) => show(m, 'error',   d), [show]),
    info:    useCallback((m: string, d?: number) => show(m, 'info',    d), [show]),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
        {items.map(t => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}
            className={`pointer-events-auto cursor-pointer flex items-start gap-2 max-w-xs px-3.5 py-2.5 rounded-xl shadow-lg text-sm ${STYLE[t.type]}`}
            role="status"
            title="클릭하여 닫기"
          >
            <span className="text-base leading-none mt-0.5 shrink-0">{ICON[t.type]}</span>
            <span className="flex-1 whitespace-pre-wrap break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
