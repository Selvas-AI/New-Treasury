import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtKRW } from '../../lib/format'
import type { KpiData } from '../../hooks/useDashboard'

interface Props {
  kpi:         KpiData
  fxKrw:       number
  onItemClick?: (key: 'asset') => void
}

export default function AssetCompositionCard({ kpi, fxKrw, onItemClick }: Props) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  const investTotal = kpi.investCash + kpi.bondCash
  const fxRatio  = kpi.availableCash > 0 ? Math.round((fxKrw / kpi.availableCash) * 100) : 0
  const krwRatio = 100 - fxRatio

  const donutData = [
    { name: '운전자금', value: kpi.operatingCash,    color: '#3b82f6' },
    { name: '가용운용', value: investTotal,           color: '#10b981' },
    { name: '불가용',   value: kpi.unavailableAssets, color: '#f59e0b' },
  ].filter(d => d.value > 0)

  const totalAssets = kpi.availableCash + kpi.unavailableAssets || 1
  const pctOf = (v: number) => Math.round((v / totalAssets) * 100)

  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f9fafb', borderRadius: 8, fontSize: 10, padding: '2px 6px' }
    : { fontSize: 10, padding: '2px 6px', borderRadius: 8, border: '1px solid #e5e7eb' }

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow p-5 flex flex-col ${onItemClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={() => onItemClick?.('asset')}
      title={onItemClick ? '클릭하여 자산 구성 상세 보기' : undefined}
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
        자산 구성
        {onItemClick && <span className="ml-1 text-[10px] text-gray-400">↗</span>}
      </h3>

      {donutData.length > 0 && (
        <div className="flex justify-center mb-2">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie
                data={donutData}
                cx={56} cy={56}
                innerRadius={34} outerRadius={54}
                dataKey="value"
                strokeWidth={2}
                stroke={isDark ? '#1f2937' : '#fff'}
              >
                {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtKRW(Number(v))} contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-1.5 mb-4">
        {[
          { name: '운전자금', color: '#3b82f6', value: kpi.operatingCash },
          { name: '가용운용', color: '#10b981', value: investTotal },
          ...(kpi.unavailableAssets > 0
            ? [{ name: '불가용', color: '#f59e0b', value: kpi.unavailableAssets }]
            : []),
        ].map(item => (
          <div key={item.name} className="flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
              {pctOf(item.value)}%
            </span>
          </div>
        ))}
      </div>

      {fxKrw > 0 && kpi.availableCash > 0 && (
        <div className="mt-auto">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">원화/외화 비율 (가용)</p>
          <div className="h-2 rounded-full overflow-hidden flex">
            <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${krwRatio}%` }} />
            <div className="bg-amber-400 h-full transition-all duration-500" style={{ width: `${fxRatio}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">원화 {krwRatio}%</span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">외화 {fxRatio}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
