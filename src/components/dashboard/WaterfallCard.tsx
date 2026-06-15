import { fmtKRW } from '../../lib/format'
import type { KpiData } from '../../hooks/useDashboard'

export type FlowItemKey = 'operating' | 'invest' | 'fx' | 'loan' | 'net' | 'unavailable' | 'available' | 'asset' | 'equity_avail'

interface Props {
  kpi:               KpiData
  fxKrw:             number        // latestDaily.fx_krw — 외화(환산) 표시용
  prevOperatingCash: number | null // 전일 운전자금 (null = 데이터 없음)
  onItemClick?:      (key: FlowItemKey) => void
  activeItem?:       FlowItemKey | null
}

// ── 작은 뱃지 컴포넌트 ──────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 ${color}`}>
      {label}
    </span>
  )
}

// ── 수평 바 행 ───────────────────────────────────────────────
function BarRow({
  label, badge, value, barColor, maxVal, indent = false, subLabel,
  onClick, active,
}: {
  label: string
  badge?: React.ReactNode
  value: number
  barColor: string
  maxVal: number
  indent?: boolean
  subLabel?: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const pct = maxVal > 0 ? Math.min((value / maxVal) * 100, 100) : 0
  return (
    <div
      className={`rounded-lg transition-colors ${indent ? 'pl-4' : ''} ${onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 px-2 -mx-2 py-1' : ''} ${active ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-700 px-2 -mx-2 py-1' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-slate-100 min-w-0">
          {indent && <span className="text-gray-400 dark:text-gray-600 text-[10px]">~</span>}
          <span className="truncate">{label}</span>
          {badge}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{fmtKRW(value)}</span>
          {subLabel}
          {onClick && <span className="text-[10px] text-gray-400">›</span>}
        </span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function WaterfallCard({ kpi, fxKrw, prevOperatingCash, onItemClick, activeItem }: Props) {
  const investTotal = kpi.investCash + kpi.bondCash
  const maxVal = Math.max(kpi.availableCash, kpi.netCashPosition, kpi.unavailableAssets, 1)
  const opDelta = prevOperatingCash !== null ? kpi.operatingCash - prevOperatingCash : null

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">자금 흐름</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">가용 합계 − 차입 = 순현금</span>
      </div>

      <div className="space-y-2.5">
        {/* 운전자금 */}
        <BarRow
          label="운전자금"
          badge={<Badge label="가용" color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" />}
          value={kpi.operatingCash}
          barColor="bg-blue-500"
          maxVal={maxVal}
          onClick={onItemClick ? () => onItemClick('operating') : undefined}
          active={activeItem === 'operating'}
          subLabel={opDelta !== null && (
            <span className={`text-[10px] font-medium tabular-nums ${
              opDelta > 0 ? 'text-red-500' : opDelta < 0 ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
            }`}>
              {opDelta > 0 ? '▲' : opDelta < 0 ? '▼' : '─'}
              {opDelta !== 0 ? fmtKRW(Math.abs(opDelta)) : ''}
            </span>
          )}
        />

        {/* 가용 운용 */}
        <BarRow
          label="가용 운용"
          badge={<Badge label="가용" color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" />}
          value={investTotal}
          barColor="bg-emerald-500"
          maxVal={maxVal}
          onClick={onItemClick ? () => onItemClick('invest') : undefined}
          active={activeItem === 'invest'}
        />

        {/* ~ 외화(환산) */}
        {fxKrw > 0 && (
          <BarRow
            label="외화(환산)"
            badge={<Badge label="FX" color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" />}
            value={fxKrw}
            barColor="bg-amber-400"
            maxVal={maxVal}
            indent
            onClick={onItemClick ? () => onItemClick('fx') : undefined}
            active={activeItem === 'fx'}
          />
        )}

        {/* 가용자산 소계 */}
        <div className="flex items-center justify-between py-1 border-t border-gray-100 dark:border-slate-700 mt-1">
          <span className="text-[11px] text-gray-500 dark:text-slate-300">가용자산 소계</span>
          <span className="text-xs font-bold text-gray-800 dark:text-gray-100 tabular-nums">{fmtKRW(kpi.availableCash)}</span>
        </div>

        {/* 차입금 */}
        <BarRow
          label="차입금"
          badge={<Badge label="차입" color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" />}
          value={kpi.totalLoan}
          barColor="bg-red-400"
          maxVal={maxVal}
          onClick={onItemClick ? () => onItemClick('loan') : undefined}
          active={activeItem === 'loan'}
          subLabel={
            <span className="text-[10px] text-red-500 dark:text-red-400 font-medium tabular-nums">
              -{fmtKRW(kpi.totalLoan)}
            </span>
          }
        />

        {/* 순현금 */}
        <div
          className={`rounded-lg transition-colors ${onItemClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 px-2 -mx-2 py-1' : ''} ${activeItem === 'net' ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-700 px-2 -mx-2 py-1' : ''}`}
          onClick={onItemClick ? () => onItemClick('net') : undefined}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
              순현금
              {onItemClick && <span className="text-[10px] text-gray-400">›</span>}
            </span>
            <span className={`text-sm font-bold tabular-nums ${
              kpi.netCashPosition >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'
            }`}>
              {kpi.netCashPosition >= 0 ? '+' : ''}{fmtKRW(kpi.netCashPosition)}
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                kpi.netCashPosition >= 0 ? 'bg-blue-500' : 'bg-red-500'
              }`}
              style={{ width: `${maxVal > 0 ? Math.min((Math.abs(kpi.netCashPosition) / maxVal) * 100, 100) : 0}%` }}
            />
          </div>
        </div>

        {/* 참고 자산 (순현금 미포함) — 지분(가용) · 불가용 */}
        {(kpi.equityAvail > 0 || kpi.unavailableAssets > 0) && (
          <div className="pt-1 border-t border-gray-100 dark:border-slate-700 space-y-2.5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500">참고 — 순현금 미포함</p>

            {/* 지분(가용) — 상장주식, 현금성과 구분해 별도 표시 */}
            {kpi.equityAvail > 0 && (
              <BarRow
                label="지분(가용)"
                badge={<Badge label="지분" color="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400" />}
                value={kpi.equityAvail}
                barColor="bg-violet-500"
                maxVal={maxVal}
                onClick={onItemClick ? () => onItemClick('equity_avail') : undefined}
                active={activeItem === 'equity_avail'}
              />
            )}

            {/* 불가용 */}
            {kpi.unavailableAssets > 0 && (
              <BarRow
                label="불가용"
                badge={<Badge label="불가" color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" />}
                value={kpi.unavailableAssets}
                barColor="bg-amber-500"
                maxVal={maxVal}
                onClick={onItemClick ? () => onItemClick('unavailable') : undefined}
                active={activeItem === 'unavailable'}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

