/**
 * ThreadPopup — 기타 입출금 항목 사유 스레드 팝업
 *
 * other_in / other_out 카테고리 선택 시 💬 버튼 클릭하면 오픈.
 * 사유 입력 + 이전 기록 로그 표시.
 */
import { useEffect, useRef, useState } from 'react'
import type { ThreadEntry } from '../../hooks/useDailyReportItems'

interface Props {
  itemId:       string
  direction:    'in' | 'out'
  memo:         string | null
  threads:      ThreadEntry[]
  isReadOnly:   boolean
  authorCode:   string
  authorLabel:  string
  onLoadThreads: (itemId: string) => Promise<void>
  onAddThread:   (itemId: string, code: string, label: string, body: string) => Promise<void>
  onUpdateMemo:  (memo: string) => void
  onClose:       () => void
}

function fmtDateTime(str: string) {
  const d = new Date(str)
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ThreadPopup({
  itemId, direction, memo, threads, isReadOnly,
  authorCode, authorLabel,
  onLoadThreads, onAddThread, onUpdateMemo, onClose,
}: Props) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void onLoadThreads(itemId)
    setTimeout(() => textareaRef.current?.focus(), 80)
  }, [itemId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    if (!body.trim()) return
    setSaving(true)
    await onAddThread(itemId, authorCode, authorLabel, body.trim())
    setBody('')
    setSaving(false)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSend()
    if (e.key === 'Escape') onClose()
  }

  const colorCls = direction === 'in'
    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
  const accentCls = direction === 'in'
    ? 'bg-green-600 hover:bg-green-700'
    : 'bg-red-500 hover:bg-red-600'

  return (
    <>
      {/* 배경 오버레이 */}
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
        onClick={onClose}
      />

      {/* 팝업 */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                   w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl
                   border border-gray-100 dark:border-gray-700 flex flex-col"
        style={{ animation: 'fadeInScale 0.16s ease-out both' }}
      >
        {/* 헤더 */}
        <div className={`px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between rounded-t-2xl ${colorCls}`}>
          <div className="flex items-center gap-2">
            <span>{direction === 'in' ? '💬 입금 사유' : '💬 출금 사유'}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">기타 항목 메모</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
          >✕</button>
        </div>

        {/* 항목 메모 (인라인 편집) */}
        <div className="px-5 pt-4 pb-2">
          <label className="text-[11px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">항목 메모</label>
          <input
            type="text"
            value={memo ?? ''}
            onChange={e => onUpdateMemo(e.target.value)}
            disabled={isReadOnly}
            placeholder="간단한 메모를 입력하세요"
            className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 dark:disabled:bg-gray-700/50"
          />
        </div>

        {/* 스레드 목록 */}
        <div className="flex-1 overflow-y-auto px-5 py-2 max-h-52 space-y-2">
          {threads.length === 0 && (
            <p className="text-xs text-gray-300 dark:text-gray-600 text-center py-4">사유 기록 없음</p>
          )}
          {threads.map(t => (
            <div key={t.id} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                  {t.author_label ?? t.author_code}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                  {fmtDateTime(t.created_at)}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{t.body}</p>
            </div>
          ))}
        </div>

        {/* 입력 영역 */}
        {!isReadOnly && (
          <div className="px-5 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={handleKey}
              rows={3}
              placeholder={`사유를 입력하세요… (Ctrl+Enter 전송)`}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={() => void handleSend()}
                disabled={saving || !body.trim()}
                className={`text-xs px-4 py-1.5 rounded-lg text-white font-medium transition-colors disabled:opacity-40 ${accentCls}`}
              >
                {saving ? '저장 중…' : '전송 (Ctrl+Enter)'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
