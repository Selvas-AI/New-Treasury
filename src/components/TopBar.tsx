import { useAuth } from '../hooks/useAuth'
import type { Company } from '../types'

const COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

export default function TopBar() {
  const { user, currentCompany, setCurrentCompany, logout } = useAuth()

  return (
    <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between shrink-0">
      {/* 법인 선택 */}
      <div className="flex items-center gap-2">
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

      {/* 사용자 정보 + 로그아웃 */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {user?.label}
          <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {user?.role}
          </span>
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
