/**
 * HelpPanel — 인앱 도움말 슬라이드 패널
 * TopBar의 ? 버튼 클릭 시 우측에서 슬라이드 인
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { findHelp } from '../lib/helpContent'

interface Props {
  open: boolean
  onClose: () => void
}

export default function HelpPanel({ open, onClose }: Props) {
  const { pathname } = useLocation()
  const help = findHelp(pathname)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open && !help) return null

  return (
    <>
      {/* backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* 패널 */}
      <aside
        className={`fixed top-0 right-0 h-full z-50 w-80 sm:w-96 bg-white dark:bg-slate-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{help?.icon ?? '❓'}</span>
            <div>
              <p className="text-[10px] font-medium text-blue-500 uppercase tracking-widest">사용 가이드</p>
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">
                {help?.title ?? '도움말'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!help ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">이 화면에 대한 도움말이 없습니다.</p>
          ) : (
            help.sections.map((sec, si) => (
              <div key={si}>
                {/* 섹션 헤더 */}
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2.5">
                  {sec.heading}
                </h3>
                <ul className="space-y-2">
                  {sec.items.map((item, ii) => (
                    <li key={ii} className="flex gap-2.5 text-sm text-gray-600 dark:text-slate-100 leading-relaxed">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            문의: IT 담당자 · <span className="text-gray-300 dark:text-gray-700">Selvas Treasury v2</span>
          </p>
        </div>
      </aside>
    </>
  )
}

