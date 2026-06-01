import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fmtKRW, fmtReturn, returnBadgeClass, fmtDateShort } from '../../lib/format'
import type { EquityRecord } from '../../types'

interface EquityWithReturn extends EquityRecord {
  returnRate: number | null
}

interface Props {
  equities: EquityWithReturn[]
  historyOf: (name: string) => EquityRecord[]
  activeKey?: string | null
  onHover?: (key: string | null) => void
  onFocus?: (key: string | null) => void
}

type Period = 14 | 30 | 90
const PERIODS: { label: string; value: Period }[] = [
  { label: '14일', value: 14 },
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
]

export default function EquityCard({ equities, historyOf, activeKey, onHover, onFocus }: Props) {
  const [filter, setFilter] = useState<string>('all')
  const [chartPeriod, setChartPeriod] = useState<Period>(30)

  const displayed = filter === 'all' ? equities : equities.filter(e => e.name === filter)
  const totalValue = equities.reduce((s, e) => s + (e.total_value || 0), 0)

  // 전체 평가합계 추이 (날짜별)
  const trendData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - chartPeriod)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    // 모든 종목의 이력 합산 (날짜별)
    const dateMap = new Map<string, number>()
    const targetEquities = filter === 'all' ? equities : equities.filter(e => e.name === filter)
    for (const eq of targetEquities) {
      const history = historyOf(eq.name).filter(h => h.date >= cutoffStr)
      for (const h of history) {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + h.total_value)
      }
    }
    return Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ dateLabel: fmtDateShort(date), value }))
  }, [equities, historyOf, filter, chartPeriod])

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-600">지분/장기투자</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800">{fmtKRW(totalValue)}</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none">
            <option value="all">전체 종목</option>
            {equities.map(e => (
              <option key={e.name} value={e.name}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 종목 목록 — 고정 높이 + 내부 스크롤 */}
      {displayed.length > 0 && (
        <div className="space-y-1 mb-3 max-h-36 overflow-y-auto pr-0.5">
          {displayed.map(eq => {
            const eqKey = `equity_${eq.name}`
            const isActive = activeKey === eqKey
            return (
            <div key={eq.name}
              onMouseEnter={() => onHover?.(eqKey)}
              onMouseLeave={() => onHover?.(null)}
              onClick={() => onFocus?.(isActive ? null : eqKey)}
              className={`flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 rounded px-1 cursor-pointer transition-colors ${
                isActive ? 'bg-amber-50 border-amber-200' : 'hover:bg-gray-50'
              }`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800 truncate">{eq.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 rounded shrink-0">{eq.market}</span>
                </div>
                {eq.acquisition_cost > 0 && (
                  <p className="text-xs text-gray-400">취득 {fmtKRW(eq.acquisition_cost)}</p>
                )}
              </div>
              <div className="text-right shrink-0 ml-2">
                <p className="text-sm font-semibold text-gray-800 tabular-nums">{fmtKRW(eq.total_value)}</p>
                {eq.returnRate !== null && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(eq.returnRate)}`}>
                    {fmtReturn(eq.returnRate)}
                  </span>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      {/* 평가 추이 차트 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-400">평가 추이</p>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setChartPeriod(p.value)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  chartPeriod === p.value ? 'bg-pink-500 text-white' : 'text-gray-400 hover:bg-gray-100'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {trendData.length < 2 ? (
          <div className="h-24 flex items-center justify-center text-xs text-gray-400">
            {trendData.length === 0 ? '이력 데이터 없음' : '데이터 부족'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gEq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ec4899" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f9f9f9" vertical={false} />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 9 }}
                tickFormatter={v => `${(v / 1_0000_0000).toFixed(0)}억`}
                width={36}
              />
              <Tooltip
                formatter={(v) => fmtKRW(Number(v))}
                contentStyle={{ fontSize: 10, padding: '2px 6px' }}
                labelStyle={{ fontSize: 10 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="평가합계"
                stroke="#ec4899"
                strokeWidth={2}
                fill="url(#gEq)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
