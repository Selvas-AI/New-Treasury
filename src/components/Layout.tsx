import { useState, useEffect, useRef } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

// ── 전역 로딩 Watchdog ─────────────────────────────────────────
// 페이지 이동 후 8초 이내에 사용자 상호작용(클릭·스크롤·키 입력)이 없으면
// "응답 지연" 오버레이를 표시하고 10초 카운트다운 후 자동 새로고침.
// 근거: 정상 페이지는 ~2s 내 콘텐츠 표시 → 사용자가 클릭/스크롤하게 됨.
//       stuck 페이지는 상호작용 불가 → 8s 후 감지.
function useLoadingWatchdog() {
  const location = useLocation()
  const [countdown, setCountdown] = useState<number | null>(null)
  const interactedRef = useRef(false)
  const watchTimerRef = useRef<number | null>(null)

  // 라우트 변경 시 Watchdog 리셋
  useEffect(() => {
    interactedRef.current = false
    setCountdown(null)
    if (watchTimerRef.current) window.clearTimeout(watchTimerRef.current)

    watchTimerRef.current = window.setTimeout(() => {
      if (!interactedRef.current) {
        // DOM 체크: 콘텐츠가 정상 렌더링됐으면 발동 안 함
        // stuck 조건 = main이 비어있거나 로딩 스피너가 여전히 돌고 있을 때만
        const main = document.querySelector('main')
        const hasContent = (main?.textContent?.trim().length ?? 0) > 100
        const hasSpinner = !!document.querySelector('.animate-spin')
        const hasLoadingText = (main?.textContent ?? '').includes('불러오는 중')
        if (!hasContent || hasSpinner || hasLoadingText) {
          setCountdown(10)
        }
      }
    }, 15_000)  // 8s → 15s (정상 페이지 오탐 방지)

    return () => {
      if (watchTimerRef.current) window.clearTimeout(watchTimerRef.current)
    }
  }, [location.pathname])

  // 카운트다운 틱
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) { window.location.reload(); return }
    const t = window.setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000)
    return () => window.clearTimeout(t)
  }, [countdown])

  // 사용자 상호작용 감지 → Watchdog 해제
  useEffect(() => {
    function handleInteraction() {
      interactedRef.current = true
      if (watchTimerRef.current) window.clearTimeout(watchTimerRef.current)
      setCountdown(null)
    }
    document.addEventListener('click',   handleInteraction)
    document.addEventListener('keydown', handleInteraction)
    document.addEventListener('scroll',  handleInteraction, true)
    return () => {
      document.removeEventListener('click',   handleInteraction)
      document.removeEventListener('keydown', handleInteraction)
      document.removeEventListener('scroll',  handleInteraction, true)
    }
  }, [])

  function dismiss() {
    interactedRef.current = true
    if (watchTimerRef.current) window.clearTimeout(watchTimerRef.current)
    setCountdown(null)
  }

  return { countdown, dismiss }
}

export default function Layout() {
  const { user } = useAuth()
  const { countdown, dismiss } = useLoadingWatchdog()

  // PC: 접기/펼치기 상태 (localStorage 유지)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })

  // 모바일: 드로어 오픈 상태
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 창 크기 변경 시 드로어 닫기
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth >= 768) setDrawerOpen(false)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="app-shell flex h-screen bg-gray-100 dark:bg-slate-950 overflow-hidden">

      {/* ── Watchdog 오버레이 ── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-800 border border-gray-600 rounded-2xl p-8 text-center max-w-xs w-full mx-4 shadow-2xl">
            <div className="text-5xl mb-4">🔄</div>
            <h2 className="text-white font-bold text-base mb-2">페이지 응답 지연</h2>
            <p className="text-gray-400 text-sm mb-1">
              데이터 로딩이 지연되고 있습니다.
            </p>
            <p className="text-gray-500 text-xs mb-6">
              {countdown}초 후 자동으로 새로고침합니다.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors mb-2"
            >
              지금 새로고침
            </button>
            <button
              onClick={dismiss}
              className="w-full text-gray-500 text-xs hover:text-gray-300 py-2 transition-colors"
            >
              계속 대기
            </button>
          </div>
        </div>
      )}

      {/* 모바일 오버레이 */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* 사이드바 — PC(고정) / 모바일(드로어 슬라이드) */}
      <div
        className={`
          fixed inset-y-0 left-0 z-30 transition-transform duration-200
          md:relative md:translate-x-0 md:z-auto
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <Sidebar
          collapsed={collapsed}
          onCollapse={toggleCollapse}
          onNavClick={() => setDrawerOpen(false)}
        />
      </div>

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 dark:bg-slate-950">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

