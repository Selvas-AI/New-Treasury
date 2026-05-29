import { useAuth } from '../hooks/useAuth'
import type { Company } from '../types'

const COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

interface Props {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: Props) {
  const { user, currentCompany, setCurrentCompany, logout } = useAuth()

  return (
    <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between shrink-0">

      {/* 왼쪽: 모바일 햄버거 + 법인 선택 */}
      <div className="flex items-center gap-3">
        {/* 햄버거 — 모바일에서만 표시 */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* 법인 선택 */}
        {user?.role !== 'company' ? (
          <select
            value={currentCompany ?? ''}
            onChange={e => setCurrentCompany(e.target.value as Company)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {COMPANIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-semibold text-gray-700">{currentCompany}</span>
        )}
      </div>

      {/* 오른쪽: 사용자 정보 + 로그아웃 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 hidden sm:inline">
          {user?.label}
        </span>
        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
          {user?.role}
        </span>
        <button
          onClick={logout}
          className="text-sm text-gray-400 hover:text-red-500 transition-colors"
        >
          로그아웃
        </button>
      </div>
    </header>
  )
}
