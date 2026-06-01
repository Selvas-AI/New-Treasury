import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtKRW } from '../../lib/format'
import type { KpiData } from '../../hooks/useDashboard'

interface Props {
  kpi: KpiData
}

export default function WaterfallCard({ kpi }: Props) {
  const total = kpi.availableCash || 1  // 0 나눔 방지

  const rows = [
    {
      label: '운전자금 (가용)',
      value: kpi.operatingCash,
      color: 'bg-blue-500',
      pct: Math.min((kpi.operatingCash / total) * 100, 100),
      tag: '운전',
    },
    {
      label: '운용자금 (가용)',
      value: kpi.investCash,
      color: 'bg-emerald-500',
      pct: Math.min((kpi.investCash / total) * 100, 100),
      tag: '운용',
    },
    {
      label: '국채 (가용)',
      value: kpi.bondCash,
      color: 'bg-indigo-400',
      pct: Math.min((kpi.bondCash / total) * 100, 100),
      tag: '국채',
    },
  ]

  // 도넛 차트 데이터
  const donutData = [
    { name: '운전자금',  value: kpi.operatingCash, color: '#3b82f6' },
    { name: '운용자금',  value: kpi.investCash,    color: '#10b981' },
    { name: '국채',      value: kpi.bondCash,       color: '#818cf8' },
    { name: '불가용',    value: kpi.unavailableAssets, color: '#e5e7eb' },
  ].filter(d => d.value > 0)

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="text-sm font-semibold text-gray-600 mb-4">자금 흐름</h3>

      <div className="flex gap-4">
        {/* 왼쪽: 수평 바 */}
        <div className="flex-1 space-y-3">
          {rows.map(row => (
            <div key={row.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${row.color}`} />
                  {row.label}
                </span>
                <span className="text-xs font-medium text-gray-700 tabular-nums">{fmtKRW(row.value)}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${row.color} rounded-full transition-all duration-500`}
                  style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}

          <div className="border-t border-gray-100 pt-3 mt-1 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">가용자산 소계</span>
              <span className="font-semibold text-gray-800">{fmtKRW(kpi.availableCash)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-red-500">차입금 (차감)</span>
              <span className="font-semibold text-red-600">-{fmtKRW(kpi.totalLoan)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1 mt-1">
              <span className={kpi.netCashPosition >= 0 ? 'text-gray-800' : 'text-red-700'}>순현금</span>
              <span className={kpi.netCashPosition >= 0 ? 'text-gray-800' : 'text-red-700'}>
                {fmtKRW(kpi.netCashPosition)}
              </span>
            </div>
            {kpi.unavailableAssets > 0 && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>불가용 자산</span>
                <span>{fmtKRW(kpi.unavailableAssets)}</span>
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 도넛 차트 */}
        {donutData.length > 0 && (
          <div className="w-28 flex flex-col items-center">
            <ResponsiveContainer width={112} height={112}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx={52} cy={52}
                  innerRadius={32} outerRadius={52}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {donutData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => fmtKRW(Number(v))}
                  contentStyle={{ fontSize: 10, padding: '2px 6px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-0.5 w-full">
              {donutData.filter(d => d.name !== '불가용').map(d => (
                <div key={d.name} className="flex items-center gap-1 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-gray-500 truncate">{d.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
