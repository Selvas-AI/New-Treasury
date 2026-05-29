import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface NavItem {
  to: string
  label: string
  icon: string
  masterOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',      label: '통합 상황판',       icon: '⊞' },
  { to: '/input',          label: '운전자금 입력',      icon: '✏️' },
  { to: '/invest',         label: '운용자금',          icon: '📈' },
  { to: '/loans',          label: '차입금',            icon: '🏦' },
  { to: '/equity',         label: '지분/장기투자',      icon: '💹' },
  { to: '/history',        label: '자금 변동 이력',     icon: '📋' },
  { to: '/issue-history',  label: '이슈 이력',          icon: '🔔' },
  { to: '/fx',             label: '환율 현황',          icon: '💱' },
]

const ADMIN_ITEMS: NavItem[] = [
  { to: '/admin/mycode',   label: '코드 변경',          icon: '🔑', masterOnly: true },
  { to: '/admin/users',    label: '사용자 관리',         icon: '👥', masterOnly: true },
  { to: '/admin/data',     label: '데이터 관리',         icon: '🗄️', masterOnly: true },
]

export default function Sidebar() {
  const { user } = useAuth()

  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-gray-300 flex flex-col">
      {/* 로고 */}
      <div className="px-5 py-5 border-b border-gray-700">
        <span className="text-white font-bold text-base tracking-wide">Selvas Treasury</span>
      </div>

      {/* 메인 메뉴 */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            <span className="w-5 text-center text-base leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        {/* 관리 메뉴 — master 전용 */}
        {user?.role === 'master' && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-xs text-gray-500 uppercase tracking-wider">관리</span>
            </div>
            {ADMIN_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-gray-700 hover:text-white'
                  }`
                }
              >
                <span className="w-5 text-center text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>
    </aside>
  )
}
