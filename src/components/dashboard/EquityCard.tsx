import { useState } from 'react'
import {
  AreaChart, Area, ResponsiveContainer, Tooltip,
} from 'recharts'
import { fmtKRW, fmtReturn, returnBadgeClass } from '../../lib/format'
import type { EquityRecord } from '../../types'

interface EquityWithReturn extends EquityRecord {
  returnRate: number | null
}

interface Props {
  equities: EquityWithReturn[]
  historyOf: (name: string) => EquityRecord[]
}

export default function EquityCard({ equities, historyOf }: Props) {
  const [filter, setFilter] = useState<string>('all')

  const displayed = filter === 'all'
    ? equities
    : equities.filter(e => e.name === filter)

  const totalValue = equities.reduce((s, e) => s + (e.total_value || 0), 0)

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="text-sm font-semibold text-gray-600">지분/장기투자</h3>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-gray-800 shrink-0">{fmtKRW(totalValue)}</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none"
          >
            <option value="all">전체</option>
            {equities.map(e => (
              <option key={e.name} value={e.name}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>

      {displayed.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">데이터가 없습니다</p>
      ) : (
        <div className="space-y-3">
          {displayed.map(eq => {
            const history = historyOf(eq.name)
              .slice(0, 30)
              .reverse()
              .map((h, i) => ({ i, v: h.total_value }))

            return (
              <div key={eq.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                {/* 종목 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{eq.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded shrink-0">
                      {eq.market}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-700">{fmtKRW(eq.total_value)}</span>
                    {eq.returnRate !== null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(eq.returnRate)}`}>
                        {fmtReturn(eq.returnRate)}
                      </span>
                    )}
                  </div>
                  {eq.acquisition_cost > 0 && (
                    <p className="text-xs text-gray-400">취득가 {fmtKRW(eq.acquisition_cost)}</p>
                  )}
                </div>

                {/* 스파크라인 */}
                {history.length > 1 && (
                  <div className="w-20 h-10 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                        <defs>
                          <linearGradient id={`spark-${eq.name}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#ec4899" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="v"
                          stroke="#ec4899"
                          strokeWidth={1.5}
                          fill={`url(#spark-${eq.name})`}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Tooltip
                          formatter={(v) => [fmtKRW(Number(v)), eq.name]}
                          contentStyle={{ fontSize: 10, padding: '2px 6px' }}
                          labelFormatter={() => ''}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
