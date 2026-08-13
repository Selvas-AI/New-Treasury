/**
 * VerdictCard — 오늘의 결론 (화면 최상단, 항상 첫 번째)
 *
 * 세션22차 신규.
 *
 * ⭐ 설계 의도:
 *   이 카드 하나만 보고 나가도 업무가 되도록 만든다.
 *   지표·차트·백테스트는 전부 "왜 그런가"를 묻는 사람을 위한 것이며,
 *   묻지 않는 사람에게는 보이지 않아야 한다.
 *
 *   과거 화면의 문제: 정보가 강의처럼 펼쳐져 있어 결론을 찾으려면 읽어야 했다.
 *   → 결론을 크게, 근거는 3줄, 나머지는 접는다.
 */
import { useState, type ReactNode } from 'react'
import type { Verdict } from '../../lib/fxVerdict'

export interface VerdictCardProps {
  verdict: Verdict
  asOf: string
  currency: string
  /** **강조** → <strong> 변환기 */
  renderBold: (text: string) => ReactNode[]
  /** "근거 자세히" 클릭 시 이동할 탭 */
  onOpenDetail: () => void
  /** 그래프 해석 팝업 */
  onOpenNarrative: () => void
}

const TONE = {
  act: {
    ring: 'border-red-300 dark:border-red-700',
    bg:   'bg-gradient-to-br from-red-50 to-white dark:from-red-950/40 dark:to-slate-900',
    badge:'bg-red-600 text-white',
    head: 'text-red-700 dark:text-red-300',
    label:'실행 필요',
    icon: '🔴',
  },
  hold: {
    ring: 'border-slate-300 dark:border-slate-600',
    bg:   'bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900',
    badge:'bg-slate-600 text-white',
    head: 'text-slate-800 dark:text-slate-100',
    label:'조치 없음',
    icon: '⚪',
  },
  warn: {
    ring: 'border-amber-300 dark:border-amber-700',
    bg:   'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-slate-900',
    badge:'bg-amber-600 text-white',
    head: 'text-amber-800 dark:text-amber-300',
    label:'확인 필요',
    icon: '🟡',
  },
} as const

export default function VerdictCard({
  verdict, asOf, currency, renderBold, onOpenDetail, onOpenNarrative,
}: VerdictCardProps) {
  const [showWhy, setShowWhy] = useState(false)
  const t = TONE[verdict.tone]

  return (
    <div className={`rounded-2xl border-2 ${t.ring} ${t.bg} p-5 shadow-sm sm:p-6`}>
      {/* 상단 배지 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${t.badge}`}>
          {t.icon} {t.label}
        </span>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">
          {asOf} 기준 · {currency}
        </span>
      </div>

      {/* 결론 — 이 화면에서 가장 큰 글씨 */}
      <h2 className={`mt-2.5 text-xl font-bold leading-snug sm:text-2xl ${t.head}`}>
        {verdict.headline}
      </h2>

      {/* 실행 지시 */}
      {verdict.order && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white/80 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/70">
          <div className="text-[11px] font-medium text-gray-500 dark:text-slate-400">오늘 할 일</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-gray-900 dark:text-slate-50">
            {verdict.order}
          </div>
          {verdict.expectedRatioAfter != null && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2 text-xs tabular-nums text-gray-600 dark:border-slate-700 dark:text-slate-300">
              <span className="font-medium text-gray-500 dark:text-slate-400">환전 후 예상 외화 보유 비중</span>
              <span>{(verdict.currentRatio * 100).toFixed(1)}%</span>
              <span className="text-gray-400 dark:text-slate-500">→</span>
              <span className="font-bold text-blue-700 dark:text-blue-400">{(verdict.expectedRatioAfter * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}

      {verdict.caveat && (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-slate-300">
          ※ {verdict.caveat}
        </p>
      )}

      {/* 액션 버튼 */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setShowWhy(v => !v)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold
                     text-gray-700 transition hover:border-gray-400 hover:bg-gray-50
                     dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >{showWhy ? '근거 접기' : '왜 그런가요?'}</button>
        <button
          onClick={onOpenNarrative}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold
                     text-gray-700 transition hover:border-gray-400 hover:bg-gray-50
                     dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >📖 그래프 해석</button>
        <button
          onClick={onOpenDetail}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold
                     text-gray-700 transition hover:border-gray-400 hover:bg-gray-50
                     dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >💰 손익 상세</button>
      </div>

      {/* 근거 — 접힘 기본. 3줄 이내 */}
      {showWhy && (
        <ol className="mt-3 space-y-1.5 rounded-xl border border-gray-200 bg-white/70 p-4
                       dark:border-slate-600 dark:bg-slate-800/60">
          {verdict.reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-700 dark:text-slate-200">
              <span className="shrink-0 font-bold text-gray-400 dark:text-slate-500">{i + 1}.</span>
              <span>{renderBold(r)}</span>
            </li>
          ))}
          <li className="mt-1 border-t border-gray-200 pt-2 text-[11px] text-gray-500 dark:border-slate-700 dark:text-slate-400">
            이 판단은 <strong>제안</strong>입니다. 실행은 기존 외화 매각 지시 워크플로우(발의 → 승인 → 완료)를 거칩니다.
          </li>
        </ol>
      )}
    </div>
  )
}
