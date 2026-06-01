import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useIssueCount } from '../contexts/issueCount'

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

interface Props {
  collapsed: boolean
  onCollapse: () => void
  onNavClick?: () => void
}

export default function Sidebar({ collapsed, onCollapse, onNavClick }: Props) {
  const { user } = useAuth()
  const { openCount } = useIssueCount()
  const w = collapsed ? 'w-14' : 'w-56'

  function linkClass({ isActive }: { isActive: boolean }) {
    return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 hover:text-white'
    }`
  }

  return (
    <aside
      className={`${w} h-full bg-gray-900 text-gray-300 flex flex-col transition-all duration-200 overflow-hidden`}
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
            {/* 이슈 이력 메뉴에 미조치 카운트 배지 */}
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
    </aside>
  )
}
