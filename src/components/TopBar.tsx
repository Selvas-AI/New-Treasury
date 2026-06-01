import { useAuth } from '../hooks/useAuth'
import { useStockTicker } from '../hooks/useStockTicker'
import type { Company } from '../types'

const COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

interface Props {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: Props) {
  const { user, currentCompany, setCurrentCompany, logout } = useAuth()
  const { tickers, loading, error, lastAt } = useStockTicker()
  // 주가 사용 여부 (price > 0인 종목이 있을 때)
  const hasPrices = tickers.some(t => t.price > 0)

  return (
    <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onMenuClick} className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="메뉴 열기">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {user?.role !== 'company' ? (
          <select value={currentCompany ?? ''} onChange={e => setCurrentCompany(e.target.value as Company)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <span className="text-sm font-semibold text-gray-700">{currentCompany}</span>
        )}
      </div>
      {/* 중앙: 주가 티커 */}
      <div className="flex-1 min-w-0 hidden sm:flex items-center gap-3 overflow-hidden px-2">
        <div className="w-px h-4 bg-gray-200 shrink-0" />
        {loading && !hasPrices ? (
          [1,2,3].map(i => (
            <div key={i} className="flex items-center gap-1 animate-pulse">
              <div className="h-3 w-12 bg-gray-200 rounded" />
              <div className="h-3 w-10 bg-gray-100 rounded" />
            </div>
          ))
        ) : !hasPrices ? (
          <span className="text-xs text-gray-300">{error ? '주가 미연결' : ''}</span>
        ) : (
          <>
            {tickers.filter(t => t.price > 0).map(t => {
              const up = (t.change ?? 0) > 0
              const dn = (t.change ?? 0) < 0
              return (
                <div key={t.code} className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-gray-500 hidden md:inline">{t.shortName}</span>
                  <span className="text-xs font-semibold text-gray-800 tabular-nums">{t.price.toLocaleString()}원</span>
                  {t.change !== undefined && t.change !== 0 && (
                    <span className={`text-xs tabular-nums ${up ? 'text-red-500' : dn ? 'text-blue-500' : 'text-gray-400'}`}>
                      {up ? '▲' : '▼'}{Math.abs(t.change).toLocaleString()}
                    </span>
                  )}
                </div>
              )
            })}
            {lastAt && <span className="text-xs text-gray-300 hidden lg:inline shrink-0">{lastAt}</span>}
          </>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm text-gray-600 hidden sm:inline">{user?.label}</span>
        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{user?.role}</span>
        <button onClick={logout} className="text-sm text-gray-400 hover:text-red-500 transition-colors">로그아웃</button>
      </div>
    </header>
  )
}
