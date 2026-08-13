/**
 * InfoTip — 지표·카드 옆에 붙는 도움말 툴팁
 *
 * 세션22차 신규. 환율 국면 화면은 개념(수준·추세·앵커·프리미엄)이 생소해
 * 처음 보는 사람이나 경영진이 숫자만 보고는 의미를 알기 어렵다.
 * 각 요소가 "무엇을 뜻하는지"를 화면에서 바로 확인할 수 있게 한다.
 *
 * ⚠ createPortal + position:fixed 필수 (세션25차).
 *   과거 absolute + 부모 상대배치 방식은 `Layout.tsx` main 의 `overflow-x-hidden`
 *   (세션11차 모바일 최적화) 등 조상의 overflow 에 잘려 좁은 카드(3열 그리드)에서
 *   툴팁 좌우가 잘려 보이는 문제가 있었다. UserPicker 포털 패턴(세션14차)과 동일하게
 *   버튼 위치를 getBoundingClientRect 로 재서 document.body 에 fixed 로 띄운다.
 *
 * ⚠ native `title` 속성을 쓰지 말 것.
 *   폴백으로 title 을 함께 부여했더니 브라우저 기본 툴팁과 커스텀 툴팁이 **동시에 두 개** 떴다.
 *   (2026-08-11 사용자 리포트) 접근성은 aria-label + aria-describedby 로 충분하다.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface InfoTipProps {
  /** 도움말 본문. 줄바꿈은 배열로 전달 */
  text: string | string[]
  /** 툴팁이 뜨는 방향 (기본 아래, 화면 밖으로 나가면 자동으로 반대쪽으로 뒤집음) */
  side?: 'top' | 'bottom'
  /** 아이콘 크기 */
  size?: 'sm' | 'md'
}

const TIP_WIDTH = 256 // px, Tailwind w-64 과 동일

export default function InfoTip({ text, side = 'bottom', size = 'sm' }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const lines = Array.isArray(text) ? text : [text]

  const calcPos = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const M = 8 // 화면 가장자리 여백
    let left = r.left + r.width / 2 - TIP_WIDTH / 2
    left = Math.min(Math.max(left, M), window.innerWidth - M - TIP_WIDTH)

    const tipH = tipRef.current?.offsetHeight ?? 0
    let top = side === 'top' ? r.top - tipH - 6 : r.bottom + 6
    // 위/아래 어느 한쪽에 공간이 부족하면 반대쪽으로 뒤집는다
    if (side === 'bottom' && top + tipH > window.innerHeight - M && r.top - tipH - 6 >= M) {
      top = r.top - tipH - 6
    } else if (side === 'top' && top < M && r.bottom + 6 + tipH <= window.innerHeight - M) {
      top = r.bottom + 6
    }
    setPos({ top, left })
  }, [side])

  useLayoutEffect(() => {
    if (open) calcPos()
  }, [open, calcPos])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (tipRef.current?.contains(t)) return
      setOpen(false)
    }
    function onScrollOrResize() { calcPos() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, calcPos])

  const iconCls = size === 'sm' ? 'h-3.5 w-3.5 text-[9px]' : 'h-4 w-4 text-[10px]'

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
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

      {open && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: TIP_WIDTH,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[9999] max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-2.5 text-left text-[11px] font-normal leading-relaxed text-gray-700 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {lines.map((l, i) => (
            <span key={i} className={i > 0 ? 'mt-1.5 block' : 'block'}>{l}</span>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}
