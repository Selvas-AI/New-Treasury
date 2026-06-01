import { useAuth } from '../hooks/useAuth'
import { useStockTicker } from '../hooks/useStockTicker'
import type { Company } from '../types'

const COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

interface Props {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: Props) {
  const { user, currentCompany, setCurrentCompany, logout } = useAuth()
  const { tickers, loading, lastAt } = useStockTicker()
  const activeTickers = tickers.filter(t => t.price > 0)
  const hasPrices = activeTickers.length > 0

  return (
    <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center gap-3 shrink-0">

      {/* 좌측: 메뉴 버튼 + 법인 선택 */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {user?.role !== 'company' ? (
          <select
            value={currentCompany ?? ''}
            onChange={e => setCurrentCompany(e.target.value as Company)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <span className="text-sm font-semibold text-gray-700">{currentCompany}</span>
        )}
      </div>

      {/* 중앙: 주가 전광판 */}
      <div className="flex-1 min-w-0 hidden sm:flex items-center overflow-hidden">
        <div className="w-px h-4 bg-gray-200 shrink-0 mr-2" />

        {loading && !hasPrices ? (
          /* 로딩 스켈레톤 */
          <div className="flex items-center gap-4 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="h-3 w-14 bg-gray-200 rounded" />
                <div className="h-3 w-10 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : hasPrices ? (
          /* 전광판 marquee */
          <div className="overflow-hidden flex-1">
            <div className="ticker-track">
              {/* 원본 + 복제본 — 50% 이동 시 seamless 루프 */}
              {[0, 1].map(dup => (
                <span key={dup} className="flex items-center gap-6 pr-12">
                  {activeTickers.map(t => {
                    const pct = t.changePct ?? 0
                    const up  = pct > 0
                    const dn  = pct < 0
                    const color = up ? 'text-red-500' : dn ? 'text-blue-500' : 'text-gray-400'
                    const arrow = up ? '▲' : dn ? '▼' : '─'
                    const sign  = up ? '+' : ''
                    return (
                      <span key={t.code} className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                        <span className="text-xs text-gray-500">{t.shortName}</span>
                        <span className="text-xs font-semibold text-gray-800 tabular-nums">
                          {t.price.toLocaleString()}
                        </span>
                        <span className={`text-xs tabular-nums font-medium ${color}`}>
                          {arrow}{sign}{Math.abs(pct).toFixed(2)}%
                        </span>
                      </span>
                    )
                  })}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {hasPrices && lastAt && (
          <span className="text-xs text-gray-300 hidden lg:inline shrink-0 ml-2">{lastAt}</span>
        )}
      </div>

      {/* 우측: 사용자 정보 + 로그아웃 */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm text-gray-600 hidden sm:inline">{user?.label}</span>
        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{user?.role}</span>
        <button onClick={logout} className="text-sm text-gray-400 hover:text-red-500 transition-colors">
          로그아웃
        </button>
      </div>

    </header>
  )
}
