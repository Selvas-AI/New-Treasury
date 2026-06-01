import { useEffect } from 'react'
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

  // 마운트 시 환율 자동 로드 — 주가 3건 GAS 요청 완료 후 호출되도록 3초 지연
  useEffect(() => {
    const timer = window.setTimeout(() => { void fx.fetchRates() }, 3000)
    return () => window.clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const w = collapsed ? 'w-14' : 'w-56'

  function linkClass({ isActive }: { isActive: boolean }) {
    return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 hover:text-white'
    }`
  }

  return (
    <aside className={`${w} h-full bg-gray-900 text-gray-300 flex flex-col transition-all duration-200 overflow-hidden`}>

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
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={linkClass}
            onClick={onNavClick}
            title={collapsed ? item.label : undefined}
          >
            <span className="w-5 shrink-0 text-center text-base leading-none">{item.icon}</span>
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {item.to === '/issue-history' && openCount > 0 && (
              <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white ${collapsed ? 'ml-0' : 'ml-auto'}`}>
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
      <div className="border-t border-gray-700 shrink-0">
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
              /* 초기 로딩 스켈레톤 */
              <div className="space-y-1.5">
                {FX_CODES.map(code => (
                  <div key={code} className="flex justify-between items-center">
                    <span className="text-xs text-gray-600">{code}</span>
                    <div className="h-2.5 w-16 bg-gray-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : fx.rates.length > 0 ? (
              /* 환율 표시 */
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
                {fx.error && (
                  <p className="text-xs text-yellow-700 mt-1">⚠ 일부 미조회</p>
                )}
              </div>
            ) : (
              /* 에러 (rates 없음) */
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
                >
                  ↺ 재시도
                </button>
              </div>
            )}
          </div>
        ) : (
          /* 접힌 상태: 💱 아이콘만 */
          <div className="flex justify-center py-3">
            <span className="text-gray-600 text-base" title="실시간 환율">💱</span>
          </div>
        )}
      </div>

    </aside>
  )
}
