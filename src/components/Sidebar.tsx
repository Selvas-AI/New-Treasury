import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useIssueCount } from '../contexts/issueCount'
import { useFx } from '../hooks/useFx'
import type { FxCode } from '../types'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',      label: '통합 상황판',    icon: '⊞' },
  { to: '/input',          label: '운전자금 입력',   icon: '✏️' },
  { to: '/invest',         label: '운용자금',        icon: '📈' },
  { to: '/loans',          label: '차입금',          icon: '🏦' },
  { to: '/equity',         label: '지분/장기투자',   icon: '💹' },
  { to: '/history',        label: '자금 변동 이력',  icon: '📋' },
  { to: '/issue-history',  label: '이슈 이력',       icon: '🔔' },
  { to: '/fx',             label: '환율 현황',       icon: '💱' },
  { to: '/policy',         label: '자금정책 관리',   icon: '📋' },
]

const ADMIN_ITEMS: NavItem[] = [
  { to: '/admin/mycode',  label: '코드 변경',   icon: '🔑' },
  { to: '/admin/users',   label: '사용자 관리', icon: '👥' },
  { to: '/admin/data',    label: '데이터 관리', icon: '🗄️' },
]

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

interface Props {
  collapsed: boolean
  onCollapse: () => void
  onNavClick?: () => void
}

export default function Sidebar({ collapsed, onCollapse, onNavClick }: Props) {
  const { user } = useAuth()
  const { openCount } = useIssueCount()
  const fx = useFx()
  const [fxPopupOpen, setFxPopupOpen] = useState(false)
  const fxRef = useRef<HTMLDivElement>(null)

  // 마운트 시 환율 자동 로드
  useEffect(() => {
    const timer = window.setTimeout(() => { void fx.fetchRates() }, 3000)
    return () => window.clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 환율 팝업 외부 클릭 닫기
  useEffect(() => {
    if (!fxPopupOpen) return
    function handler(e: MouseEvent) {
      if (fxRef.current && !fxRef.current.contains(e.target as Node)) {
        setFxPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fxPopupOpen])

  const w = collapsed ? 'w-14' : 'w-56'

  function linkClass({ isActive }: { isActive: boolean }) {
    return `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 hover:text-white'
    }`
  }

  return (
    <aside className={`${w} h-full bg-gray-900 text-gray-300 flex flex-col transition-all duration-200`}
      style={{ overflow: collapsed ? 'visible' : 'hidden' }}
    >
      {/* 헤더 + 접기 버튼 */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-gray-700 shrink-0">
        {!collapsed && (
          <span className="text-white font-bold text-sm tracking-wide truncate">
            Selvas Treasury
          </span>
        )}
        <button
          onClick={onCollapse}
          className="ml-auto text-gray-400 hover:text-white p-1 rounded transition-colors shrink-0"
          title={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* 메인 메뉴 */}
      <nav className={`flex-1 px-2 py-4 space-y-0.5 ${collapsed ? 'overflow-visible' : 'overflow-y-auto sidebar-scroll'}`}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={linkClass}
            onClick={onNavClick}
            title={collapsed ? item.label : undefined}
          >
            {/* 이슈 아이콘 뱃지 (접힌 상태에서 아이콘 우상단) */}
            <span className={`relative shrink-0 w-5 text-center text-base leading-none ${collapsed ? 'block' : ''}`}>
              {item.icon}
              {item.to === '/issue-history' && openCount > 0 && collapsed && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 text-[9px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center leading-none z-10">
                  {openCount}
                </span>
              )}
            </span>
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {/* 펼친 상태 배지 */}
            {item.to === '/issue-history' && openCount > 0 && !collapsed && (
              <span className="ml-auto shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
                {openCount}
              </span>
            )}
          </NavLink>
        ))}

        {/* 관리 메뉴 — master 전용 */}
        {user?.role === 'master' && (
          <>
            {!collapsed && (
              <div className="pt-4 pb-1 px-3">
                <span className="text-xs text-gray-500 uppercase tracking-wider">관리</span>
              </div>
            )}
            {collapsed && <div className="pt-2 border-t border-gray-700 mt-2" />}
            {ADMIN_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={linkClass}
                onClick={onNavClick}
                title={collapsed ? item.label : undefined}
              >
                <span className="w-5 shrink-0 text-center text-base leading-none">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* ── 하단: 실시간 환율 ── */}
      <div className="border-t border-gray-700 shrink-0" ref={fxRef}>
        {!collapsed ? (
          <div className="px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">실시간 환율</span>
              {fx.loading ? (
                <span className="text-xs text-gray-600 animate-pulse">조회 중…</span>
              ) : (
                <button
                  onClick={() => void fx.fetchRates()}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                  title="환율 새로고침"
                >↺</button>
              )}
            </div>

            {(fx.loading && fx.rates.length === 0) ? (
              <div className="space-y-1.5">
                {FX_CODES.map(code => (
                  <div key={code} className="flex justify-between items-center">
                    <span className="text-xs text-gray-600">{code}</span>
                    <div className="h-2.5 w-16 bg-gray-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : fx.rates.length > 0 ? (
              <div className="space-y-1">
                {FX_CODES.map(code => {
                  const r = fx.rates.find(r => r.code === code)
                  const label = code === 'JPY' ? '100JPY' : code
                  const display = r?.rate
                    ? `${(code === 'JPY' ? r.rate * 100 : r.rate).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`
                    : '—'
                  return (
                    <div key={code} className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">{label}</span>
                      <span className="text-xs font-medium text-gray-300 tabular-nums">{display}</span>
                    </div>
                  )
                })}
                {fx.error && <p className="text-xs text-yellow-700 mt-1">⚠ 일부 미조회</p>}
              </div>
            ) : (
              <div className="space-y-1.5">
                {FX_CODES.map(code => (
                  <div key={code} className="flex justify-between items-center">
                    <span className="text-xs text-gray-600">{code}</span>
                    <span className="text-xs text-gray-700">—</span>
                  </div>
                ))}
                <button
                  onClick={() => void fx.fetchRates()}
                  className="text-xs text-gray-600 hover:text-gray-400 mt-1 w-full text-left"
                >↺ 재시도</button>
              </div>
            )}
          </div>
        ) : (
          /* 접힌 상태: 💱 클릭 → 환율 팝업 */
          <div className="relative flex justify-center py-3">
            <button
              onClick={() => {
                setFxPopupOpen(prev => !prev)
                if (!fx.rates.length && !fx.loading) void fx.fetchRates()
              }}
              className="text-gray-500 hover:text-gray-300 text-base transition-colors p-1 rounded hover:bg-gray-700"
              title="실시간 환율"
            >
              💱
            </button>

            {/* 환율 팝업 (사이드바 우측으로 슬라이드) */}
            {fxPopupOpen && (
              <div
                style={{ animation: 'slideInLeft 0.15s ease-out both' }}
                className="absolute left-full bottom-0 ml-2 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl px-3 py-3 z-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400 font-medium">실시간 환율</span>
                  <button
                    onClick={() => void fx.fetchRates()}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                    title="새로고침"
                  >↺</button>
                </div>
                {fx.loading && fx.rates.length === 0 ? (
                  <div className="space-y-1.5">
                    {FX_CODES.map(code => (
                      <div key={code} className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">{code}</span>
                        <div className="h-2.5 w-14 bg-gray-700 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : fx.rates.length > 0 ? (
                  <div className="space-y-1.5">
                    {FX_CODES.map(code => {
                      const r = fx.rates.find(r => r.code === code)
                      const label = code === 'JPY' ? '100JPY' : code
                      const display = r?.rate
                        ? `${(code === 'JPY' ? r.rate * 100 : r.rate).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`
                        : '—'
                      return (
                        <div key={code} className="flex justify-between items-center">
                          <span className="text-xs text-gray-500">{label}</span>
                          <span className="text-xs font-medium text-gray-300 tabular-nums">{display}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-1">데이터 없음</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
