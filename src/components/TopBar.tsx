import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useStockTicker } from '../hooks/useStockTicker'
import { useDarkMode } from '../hooks/useDarkMode'
import { useCompanies } from '../hooks/useCompanies'
import HelpPanel from './HelpPanel'
import type { Company } from '../types'

/** GAS 자동 갱신 스케줄: 09:15 / 12:15 / 15:45 */
function getNextRefresh(): string {
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  for (const [h, m] of [[9, 15], [12, 15], [15, 45]]) {
    if (cur < h * 60 + m) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return '09:15'
}

/** 장 시간 여부 */
function isMarketHours(): boolean {
  const d = new Date()
  const cur = d.getHours() * 60 + d.getMinutes()
  return cur >= 9 * 60 && cur < 15 * 60 + 30
}

function Divider() {
  return <span className="w-px h-4 bg-gray-200 dark:bg-slate-700 shrink-0" />
}

/** 아이콘+툴팁 버튼 (소형 화면) */
function IconBtn({
  icon, label, onClick, className = '',
}: { icon: string; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative group flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-sm ${className}`}
    >
      {icon}
      {/* 툴팁 */}
      <span className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 text-white text-[10px] px-2 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {label}
      </span>
    </button>
  )
}

interface Props {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: Props) {
  const { user, currentCompany, setCurrentCompany, logout } = useAuth()
  const { tickers, loading, lastAt } = useStockTicker()
  const { dark, toggle: toggleDark } = useDarkMode()
  const { names: companyNames } = useCompanies()
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)

  const activeTickers = tickers.filter(t => t.price > 0)
  const hasPrices     = activeTickers.length > 0
  const marketOn      = isMarketHours()

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\.\s*/g, '.').replace(/\.$/, '')

  const roleBadge: Record<string, string> = {
    master:  'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
    ceo:     'bg-blue-700 text-white',
    company: 'bg-emerald-600 text-white',
  }

  return (
    <header className="h-14 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 px-3 flex items-center gap-2 shrink-0 z-10 overflow-hidden">

      {/* ── 좌측: 햄버거 + 법인 선택 ──────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="메뉴"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {user?.role !== 'company' ? (
          <select
            value={currentCompany ?? ''}
            onChange={e => setCurrentCompany(e.target.value as Company)}
            className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-[9rem] sm:max-w-none"
          >
            {companyNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[8rem]">{currentCompany}</span>
        )}
      </div>

      {/* ── 중앙: 주가 마퀴 티커 ─────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden relative hidden sm:block mx-1">
        {/* edge fade */}
        <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white dark:from-gray-900 to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white dark:from-gray-900 to-transparent z-10 pointer-events-none" />
        {hasPrices && (
          <div className="stock-ticker-track">
            {[0, 1, 2, 3].map(pass => (
              <span key={pass} className="flex items-center gap-1.5 px-6">
                {activeTickers.map((t, idx) => {
                  const pct = t.changePct ?? 0
                  const up  = pct > 0; const dn = pct < 0
                  const col = up ? 'text-red-500' : dn ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
                  return (
                    <span key={`${pass}-${t.code}`} className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                      {idx > 0 && <span className="text-gray-300 dark:text-gray-600 mx-1">·</span>}
                      <span className="text-xs text-gray-500 dark:text-slate-300">{t.shortName}</span>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{t.price.toLocaleString()}원</span>
                      <span className={`text-xs tabular-nums font-medium ${col}`}>
                        {up ? '▲' : dn ? '▼' : '─'}{Math.abs(pct).toFixed(2)}%
                      </span>
                    </span>
                  )
                })}
                {lastAt && <span className="text-[10px] text-gray-300 dark:text-gray-600 tabular-nums ml-3">{lastAt}</span>}
              </span>
            ))}
          </div>
        )}
        {loading && !hasPrices && (
          <div className="flex items-center gap-2 animate-pulse px-2 h-full">
            <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded" />
            <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        )}
      </div>

      {/* ── 우측 정보/액션 (반응형) ───────────────────────── */}
      <div className="flex items-center gap-1.5 shrink-0">

        {/* ── 날짜 · 갱신 시각: lg 이상만 텍스트 표시 ── */}
        <span className="hidden lg:inline text-xs text-gray-500 dark:text-slate-300 tabular-nums">{today}</span>
        <span className="hidden lg:block w-px h-4 bg-gray-200 dark:bg-slate-700" />

        <span className="hidden md:flex items-center gap-1 text-xs text-gray-500 dark:text-slate-300">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${marketOn ? 'bg-emerald-400 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
          <span className="hidden lg:inline">다음 </span>{getNextRefresh()}
        </span>
        <span className="hidden md:block w-px h-4 bg-gray-200 dark:bg-slate-700" />

        {/* 역할 배지 */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full leading-none shrink-0 ${roleBadge[user?.role ?? 'company'] ?? ''}`}>
          {user?.role === 'master' ? 'Master' : user?.role === 'ceo' ? 'CEO' : user?.label ?? ''}
        </span>

        <Divider />

        {/* 환율 */}
        <div className="hidden sm:flex">
          {/* lg 이상: 텍스트 */}
          <button
            onClick={() => navigate('/fx')}
            className="hidden lg:flex items-center gap-1 text-xs text-gray-500 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
            title="환율 현황"
          >
            <span>↺</span><span>환율</span>
          </button>
          {/* sm~lg: 아이콘 */}
          <IconBtn icon="💱" label="환율 현황" onClick={() => navigate('/fx')} className="lg:hidden" />
        </div>

        <Divider />

        {/* 다크모드 토글 */}
        {/* lg 이상: 풀 토글 pill */}
        <button
          onClick={toggleDark}
          className="hidden lg:flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          aria-label="테마 전환"
          title="테마 전환"
        >
          <span className={!dark ? 'font-semibold text-gray-700 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}>라이트</span>
          <span className={`relative inline-flex w-9 h-5 rounded-full border transition-colors ${dark ? 'bg-gray-700 border-gray-600' : 'bg-gray-200 border-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white dark:bg-gray-300 rounded-full shadow-sm transition-transform duration-200 ${dark ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          <span className={dark ? 'font-semibold text-gray-200' : 'text-gray-400'}>다크</span>
        </button>
        {/* sm~lg: 아이콘 버튼 */}
        <IconBtn
          icon={dark ? '☀️' : '🌙'}
          label={dark ? '라이트 모드' : '다크 모드'}
          onClick={toggleDark}
          className="lg:hidden"
        />

        <Divider />

        {/* 코드 관리 */}
        {user?.role === 'master' && (
          <>
            <button
              onClick={() => navigate('/admin/users')}
              className="hidden lg:flex items-center gap-1 text-xs text-gray-500 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
              title="코드 관리"
            >
              <span>⚙</span><span>코드 관리</span>
            </button>
            <IconBtn icon="⚙" label="코드 관리" onClick={() => navigate('/admin/users')} className="lg:hidden hidden sm:flex" />
            <Divider />
          </>
        )}

        {/* 도움말 */}
        <button
          onClick={() => setHelpOpen(v => !v)}
          aria-label="도움말"
          title="도움말"
          className="flex items-center justify-center w-8 h-8 rounded-lg font-bold text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-sm"
        >
          ?
        </button>

        <Divider />

        {/* 로그아웃 */}
        {/* lg 이상: 텍스트 */}
        <button
          onClick={logout}
          className="hidden lg:block text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1"
          title="로그아웃"
        >
          로그아웃
        </button>
        {/* sm~lg: 아이콘 */}
        <IconBtn icon="⎋" label="로그아웃" onClick={logout} className="lg:hidden" />

      </div>

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  )
}

