/**
 * NarrativeModal — 차트 자동 해석 팝업
 *
 * 세션22차 신규. 본문은 fxChartNarrative.buildChartNarrative() 가 생성한다.
 *
 * ⚠ 팝업 애니메이션 주의 (CLAUDE.md §10 전례):
 *   @keyframes fadeInScale 에 translate 를 넣으면 Tailwind 의 transform 변수와 충돌해
 *   팝업이 한쪽에 나타났다 중앙으로 튀는 깜빡임이 생긴다.
 *   위치는 Tailwind(-translate-x/y-1/2)가, 애니메이션은 opacity+scale 만 담당한다.
 */
import { useEffect, type ReactNode } from 'react'
import type { NarrativeSection } from '../../lib/fxChartNarrative'

export interface NarrativeModalProps {
  open:      boolean
  onClose:   () => void
  sections:  NarrativeSection[]
  /** 헤더 부제 (예: "2026-08-11 기준 · USD") */
  subtitle?: string
  /** **강조** 표기를 <strong> 으로 바꾸는 렌더러 */
  renderBold: (text: string) => ReactNode[]
}

export default function NarrativeModal({
  open, onClose, sections, subtitle, renderBold,
}: NarrativeModalProps) {
  // ESC 로 닫기
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* 배경 — 클릭하면 닫힘 */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="그래프 해석"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl
                   -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl
                   border border-gray-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}
      >
        {/* 헤더 (고정) */}
        <div className="flex shrink-0 items-start gap-3 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900 dark:text-slate-100">
              📖 이 그래프는 무슨 뜻인가요?
            </div>
            <div className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
              {subtitle && <span className="mr-1">{subtitle} ·</span>}
              오늘 지표값에서 <strong>자동으로 생성</strong>된 설명입니다. 사람이 미리 써둔 글이 아닙니다.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-400
                       transition hover:bg-gray-100 hover:text-gray-700
                       dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >✕</button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {sections.map(s => (
            <section key={s.title}>
              <h4 className="text-[14px] font-bold text-gray-900 dark:text-slate-100">
                {s.icon} {s.title}
              </h4>
              {s.body.map((p, i) => (
                <p key={i} className="mt-1.5 text-[13.5px] leading-relaxed text-gray-700 dark:text-slate-200">
                  {renderBold(p)}
                </p>
              ))}
            </section>
          ))}
        </div>

        {/* 푸터 (고정) */}
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-200 px-5 py-3 dark:border-slate-700">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            이 설명은 <strong>관찰</strong>이지 예측이 아닙니다. 실행은 기존 승인 절차를 거칩니다.
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white
                       transition hover:bg-gray-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >닫기</button>
        </div>
      </div>
    </>
  )
}
