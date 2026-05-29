import { useState, useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  const { user } = useAuth()

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
    <div className="flex h-screen bg-gray-100 overflow-hidden">

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
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
