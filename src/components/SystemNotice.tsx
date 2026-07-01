/**
 * 시스템 공지 팝업 (오늘 전용 · 계정별)
 *
 * - NOTICE.activeDate 당일에만 노출.
 * - "다시 보지 않기" 체크 후 닫으면 해당 공지를 로그인 계정별로 영구 숨김.
 *   (localStorage 키 `treasury_notice_dismiss_{계정}` 에 dismiss된 공지 id 배열 저장)
 * - 체크 없이 닫으면 세션 한정(재로그인/새로고침 시 당일에 한해 재노출).
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Notice {
  id: string
  activeDate: string   // YYYY-MM-DD — 이 날짜에만 노출
  title: string
  lines: string[]
}

// 공지 전체 on/off 스위치 (false면 어떤 공지도 노출하지 않음)
const NOTICE_ENABLED = false

// 금일 공지 (2026-07-01 GAS UrlFetch 할당량 초과 안내)
const NOTICE: Notice = {
  id: '2026-07-01-gas-quota',
  activeDate: '2026-07-01',
  title: '금일 환율·주식 시세 안내',
  lines: [
    '어제 업데이트 이후 발생한 기술적 문제로, 금일은 환율 및 주식 시세 조회가 어렵습니다.',
    '관련 조치는 오늘 완료하였으며, 정상화는 내일부터 이루어질 예정입니다.',
    '그 외 자금 데이터 조회·입력은 정상적으로 이용하실 수 있습니다.',
  ],
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SystemNotice() {
  const { user } = useAuth()
  const acct = user?.sb_id ?? user?.email ?? 'anon'
  const storageKey = `treasury_notice_dismiss_${acct}`

  // 활성일이면 기본 노출(초기화 함수로 동기 계산 — 리렌더/StrictMode에 견고).
  // 계정별 "다시 보지 않기" 여부는 user 로드 후 effect에서 닫는 방향으로만 반영.
  const [open, setOpen] = useState<boolean>(() => NOTICE_ENABLED && todayStr() === NOTICE.activeDate)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (!user) return
    if (todayStr() !== NOTICE.activeDate) { setOpen(false); return }
    let dismissed: string[] = []
    try { dismissed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { /* ignore */ }
    if (dismissed.includes(NOTICE.id)) setOpen(false)
  }, [user, storageKey])

  function close() {
    if (dontShow) {
      let dismissed: string[] = []
      try { dismissed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { /* ignore */ }
      if (!dismissed.includes(NOTICE.id)) {
        dismissed.push(NOTICE.id)
        try { localStorage.setItem(storageKey, JSON.stringify(dismissed)) } catch { /* ignore */ }
      }
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-2xl overflow-hidden"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-3">
          <span className="text-3xl">⚠️</span>
          <h2 className="text-base font-bold text-gray-900 dark:text-slate-100 leading-snug">
            {NOTICE.title}
          </h2>
        </div>

        {/* 본문 */}
        <div className="px-6 pb-2 space-y-2.5">
          {NOTICE.lines.map((line, i) => (
            <p key={i} className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed flex gap-2">
              <span className="text-amber-500 mt-0.5 shrink-0">•</span>
              <span>{line}</span>
            </p>
          ))}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 mt-2 border-t border-gray-100 dark:border-slate-700">
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={e => setDontShow(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-slate-500 text-blue-600 focus:ring-blue-500"
            />
            다시 보지 않기
          </label>
          <button
            onClick={close}
            className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
