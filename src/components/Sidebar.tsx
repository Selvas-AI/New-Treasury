import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useIssueCount } from '../contexts/issueCount'
import { useFx } from '../hooks/useFx'
import type { FxCode } from '../types'

interface NavItem {
  to: string
  label: string
  icon: string
  slug: string  // hasMenu() 체크용 메뉴 슬러그
}

interface NavGroup {
  section: string   // 섹션 헤더 (collapsed 시 구분선으로만 표시)
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    section: 'DASHBOARD',
    items: [
      { to: '/dashboard', label: '통합 상황판', icon: '⊞', slug: 'dashboard' },
      { to: '/policy',    label: '자금정책',    icon: '📋', slug: 'policy'    },
    ],
  },
  {
    section: '자금입력',
    items: [
      { to: '/input',   label: '운전자금',     icon: '✏️', slug: 'input'  },
      { to: '/invest',  label: '운용자금',      icon: '📈', slug: 'invest' },
      { to: '/equity',  label: '지분/장기투자', icon: '💹', slug: 'equity' },
      { to: '/loans',   label: '차입금',        icon: '🏦', slug: 'loans'  },
    ],
  },
  {
    section: '자금일보',
    items: [
      { to: '/daily-report',      label: '자금일보 작성',     icon: '📄', slug: 'daily' },
      { to: '/daily-report-list', label: '일별 자금일보 목록', icon: '📅', slug: 'daily' },
    ],
  },
  {
    section: '이력관리',
    items: [
      { to: '/history',       label: '자금 변동 이력', icon: '📂', slug: 'history' },
      { to: '/issue-history', label: '이슈 이력',      icon: '🔔', slug: 'history' },
      { to: '/fx',            label: '환율 이력',      icon: '💱', slug: 'fx'      },
    ],
  },
]

const ADMIN_ITEMS: NavItem[] = [
  { to: '/admin/mycode',    label: '코드 변경',   icon: '🔑', slug: 'admin' },
  { to: '/admin/companies', label: '회사 관리',   icon: '🏢', slug: 'admin' },
  { to: '/admin/users',     label: '사용자 관리', icon: '👥', slug: 'admin' },
  { to: '/admin/data',      label: '데이터 관리', icon: '🗄️', slug: 'admin' },
  { to: '/admin/org-chart', label: '조직도 관리', icon: '🏬', slug: 'admin' },
]

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

interface Props {
  collapsed: boolean
  onCollapse: () => void
  onNavClick?: () => void
}

export default function Sidebar({ collapsed, onCollapse, onNavClick }: Props) {
  const { user, hasMenu } = useAuth()
  const { openCount } = useIssueCount()
  const fx = useFx()
  const location = useLocation()
  const [fxPopupOpen, setFxPopupOpen] = useState(false)
  const fxRef = useRef<HTMLDivElement>(null)

  // 섹션 접기/펴기 — 현재 경로가 속한 섹션은 기본 열림
  const getDefaultOpen = () => {
    const path = location.pathname
    const openMap: Record<string, boolean> = {}
    NAV_GROUPS.forEach(g => {
      openMap[g.section] = g.items.some(i => path.startsWith(i.to))
    })
    if (!Object.values(openMap).some(Boolean)) openMap[NAV_GROUPS[0].section] = true
    return openMap
  }
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(getDefaultOpen)

  // localStorage 키 (유저별)
  const lsKey = user?.sb_id ? `sidebar_sections_${user.sb_id}` : null

  // 유저 로드 후 저장된 상태 복원 (현재 경로 섹션은 강제 열기)
  useEffect(() => {
    if (!lsKey) return
    const saved = localStorage.getItem(lsKey)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as Record<string, boolean>
      const withActive = { ...parsed }
      NAV_GROUPS.forEach(g => {
        if (g.items.some(i => location.pathname.startsWith(i.to))) {
          withActive[g.section] = true
        }
      })
      setOpenSections(withActive)
    } catch { /* ignore malformed */ }
  }, [lsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSection(section: string) {
    setOpenSections(prev => {
      const next = { ...prev, [section]: !prev[section] }
      if (lsKey) localStorage.setItem(lsKey, JSON.stringify(next))
      return next
    })
  }

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
          <NavLink
            to="/dashboard"
            className="text-white font-bold text-xs tracking-widest uppercase truncate hover:text-blue-300 transition-colors"
          >
            SELVAS TREASURY
          </NavLink>
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
      <nav className={`flex-1 px-2 py-3 ${collapsed ? 'overflow-visible' : 'overflow-y-auto sidebar-scroll'}`}>
        {NAV_GROUPS.map((group, gi) => {
          const visibleItems = group.items.filter(i => hasMenu(i.slug))
          if (visibleItems.length === 0) return null  // 접근 가능한 항목 없으면 섹션 전체 숨김
          const isOpen = collapsed || openSections[group.section]
          const hasActive = visibleItems.some(i => location.pathname.startsWith(i.to))
          return (
            <div key={group.section} className={gi > 0 ? 'mt-1' : ''}>
              {/* 섹션 헤더 (접힌 사이드바면 구분선만) */}
              {!collapsed ? (
                <button
                  onClick={() => toggleSection(group.section)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md transition-colors group ${
                    gi > 0 ? 'mt-2' : ''
                  } hover:bg-gray-800`}
                >
                  <span className={`text-[10px] uppercase tracking-widest font-semibold transition-colors ${
                    hasActive ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'
                  }`}>
                    {group.section}
                  </span>
                  <span className={`text-gray-600 text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                </button>
              ) : (
                gi > 0 && <div className="my-2 border-t border-gray-700/60" />
              )}

              {/* 섹션 아이템 (접혀있으면 숨김, 사이드바 collapsed면 항상 표시) */}
              <div className={`space-y-0.5 overflow-hidden transition-all duration-200 ${
                isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              }`}>
                <div className={!collapsed ? 'pl-1 mt-0.5' : ''}>
                  {visibleItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={linkClass}
                      onClick={onNavClick}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="relative shrink-0 w-5 text-center text-base leading-none">
                        {item.icon}
                        {item.to === '/issue-history' && openCount > 0 && collapsed && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 text-[9px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center leading-none z-10">
                            {openCount}
                          </span>
                        )}
                      </span>
                      {!collapsed && <span className="flex-1 truncate text-[13px]">{item.label}</span>}
                      {item.to === '/issue-history' && openCount > 0 && !collapsed && (
                        <span className="ml-auto shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
                          {openCount}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          )
        })}

        {/* 관리 메뉴 — master 전용 */}
        {user?.role === 'master' && (() => {
          const isOpen = collapsed || openSections['관리']
          const hasActive = ADMIN_ITEMS.some(i => location.pathname.startsWith(i.to))
          return (
            <div className="mt-1">
              {!collapsed ? (
                <button
                  onClick={() => toggleSection('관리')}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md mt-2 hover:bg-gray-800 transition-colors group"
                >
                  <span className={`text-[10px] uppercase tracking-widest font-semibold transition-colors ${
                    hasActive ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'
                  }`}>
                    관리
                  </span>
                  <span className={`text-gray-600 text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                </button>
              ) : (
                <div className="my-2 border-t border-gray-700/60" />
              )}
              <div className={`space-y-0.5 overflow-hidden transition-all duration-200 ${
                isOpen ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'
              }`}>
                <div className={!collapsed ? 'pl-1 mt-0.5' : ''}>
                  {ADMIN_ITEMS.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={linkClass}
                      onClick={onNavClick}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="w-5 shrink-0 text-center text-base leading-none">{item.icon}</span>
                      {!collapsed && <span className="truncate text-[13px]">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
      </nav>

      {/* ── 하단: 실시간 환율 ── */}
      <div className="border-t border-gray-700 shrink-0" ref={fxRef}>
        {!collapsed ? (
          <div className="px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">실시간 환율</span>
              {fx.loading ? (
                <span className="text-xs text-gray-600 dark:text-slate-300 animate-pulse">조회 중…</span>
              ) : (
                <button
                  onClick={() => void fx.fetchRates()}
                  className="text-xs text-gray-600 dark:text-slate-300 hover:text-gray-400 transition-colors"
                  title="환율 새로고침"
                >↺</button>
              )}
            </div>

            {(fx.loading && fx.rates.length === 0) ? (
              <div className="space-y-1.5">
                {FX_CODES.map(code => (
                  <div key={code} className="flex justify-between items-center">
                    <span className="text-xs text-gray-600 dark:text-slate-300">{code}</span>
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
                    <span className="text-xs text-gray-600 dark:text-slate-300">{code}</span>
                    <span className="text-xs text-gray-700">—</span>
                  </div>
                ))}
                <button
                  onClick={() => void fx.fetchRates()}
                  className="text-xs text-gray-600 dark:text-slate-300 hover:text-gray-400 mt-1 w-full text-left"
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
                    className="text-xs text-gray-600 dark:text-slate-300 hover:text-gray-400 transition-colors"
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

