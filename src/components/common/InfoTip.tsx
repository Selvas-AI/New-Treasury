/**
 * InfoTip — 지표·카드 옆에 붙는 도움말 툴팁
 *
 * 세션22차 신규. 환율 국면 화면은 개념(수준·추세·앵커·프리미엄)이 생소해
 * 처음 보는 사람이나 경영진이 숫자만 보고는 의미를 알기 어렵다.
 * 각 요소가 "무엇을 뜻하는지"를 화면에서 바로 확인할 수 있게 한다.
 *
 * ⚠ 클리핑 주의: 과거 TopBar 커스텀 툴팁이 overflow:hidden 헤더 안에서 잘린 전례가 있다.
 *   여기서는 z-50 + 카드 내부(overflow 미설정) 배치를 전제로 하며,
 *   가로 스크롤 테이블(overflow-x-auto) 안에는 넣지 않는다.
 *
 * ⚠ native `title` 속성을 쓰지 말 것.
 *   폴백으로 title 을 함께 부여했더니 브라우저 기본 툴팁과 커스텀 툴팁이 **동시에 두 개** 떴다.
 *   (2026-08-11 사용자 리포트) 접근성은 aria-label + aria-describedby 로 충분하다.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react'

export interface InfoTipProps {
  /** 도움말 본문. 줄바꿈은 배열로 전달 */
  text: string | string[]
  /** 툴팁이 뜨는 방향 (기본 아래) */
  side?: 'top' | 'bottom'
  /** 아이콘 크기 */
  size?: 'sm' | 'md'
}

export default function InfoTip({ text, side = 'bottom', size = 'sm' }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  /** 뷰포트 밖으로 나가지 않도록 좌우로 밀어낸 픽셀 (양수=오른쪽) */
  const [shift, setShift] = useState(0)
  const tipRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const lines = Array.isArray(text) ? text : [text]

  // ⚠ 툴팁은 아이콘 중앙 정렬(-translate-x-1/2)이라, 아이콘이 화면 왼쪽 끝에 있으면
  //   툴팁 절반이 화면 밖으로 잘린다(2026-08-11 사용자 리포트: 사이드바 옆 카드에서 발생).
  //   열린 뒤 실제 위치를 재서 화면 안으로 밀어 넣는다.
  useLayoutEffect(() => {
    if (!open) { setShift(0); return }
    const el = tipRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const M = 8   // 화면 가장자리 여백
    let dx = 0
    if (r.left < M) dx = M - r.left
    else if (r.right > window.innerWidth - M) dx = window.innerWidth - M - r.right
    if (dx !== 0) setShift(prev => prev + dx)
  }, [open])

  const iconCls = size === 'sm' ? 'h-3.5 w-3.5 text-[9px]' : 'h-4 w-4 text-[10px]'

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="도움말"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={e => { e.preventDefault(); setOpen(v => !v) }}
        className={`${iconCls} ml-1 inline-flex shrink-0 items-center justify-center rounded-full border border-gray-300 font-bold text-gray-400 transition hover:border-blue-400 hover:text-blue-500 dark:border-slate-600 dark:text-slate-500 dark:hover:border-blue-400 dark:hover:text-blue-400`}
      >?</button>

      {open && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          style={{ marginLeft: shift }}
          className={`absolute left-1/2 z-50 w-64 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2.5 text-left text-[11px] font-normal leading-relaxed text-gray-700 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {lines.map((l, i) => (
            <span key={i} className={i > 0 ? 'mt-1.5 block' : 'block'}>{l}</span>
          ))}
        </span>
      )}
    </span>
  )
}
