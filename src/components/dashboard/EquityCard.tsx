import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fmtKRW, fmtReturn, returnBadgeClass, fmtDateShort, calcReturn } from '../../lib/format'
import type { EquityRecord } from '../../types'
import type { BondSummary } from '../../hooks/useDashboard'

interface EquityWithReturn extends EquityRecord {
  returnRate: number | null
}

interface Props {
  equities:      EquityWithReturn[]
  historyOf:     (name: string) => EquityRecord[]
  bonds:         BondSummary[]
  bondHistoryOf: (isin: string) => { date: string; value: number }[]
  activeKey?:    string | null
  onHover?:      (key: string | null) => void
  onFocus?:      (key: string | null) => void
}

type Period = 7 | 14 | 30 | 90
const PERIODS: { label: string; value: Period }[] = [
  { label: '7일',  value: 7  },
  { label: '14일', value: 14 },
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
]

export default function EquityCard({
  equities, historyOf, bonds, bondHistoryOf,
  activeKey, onHover, onFocus,
}: Props) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const [filter, setFilter]           = useState<string>('all')
  const [chartPeriod, setChartPeriod] = useState<Period>(7)

  const isBondFilter   = filter.startsWith('bond_')
  const bondFilterIsin = isBondFilter ? filter.replace('bond_', '') : null

  const displayedEquities = isBondFilter ? []
    : filter === 'all' ? equities
    : equities.filter(e => e.name === filter)

  const displayedBonds = isBondFilter
    ? bonds.filter(b => b.isin === bondFilterIsin)
    : filter === 'all' ? bonds : []

  const totalValue =
    equities.reduce((s, e) => s + (e.total_value || 0), 0) +
    bonds.reduce((s, b) => s + b.value, 0)

  const isBondOnly = isBondFilter

  const trendData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - chartPeriod)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const dateMap = new Map<string, number>()

    const targetEquities = isBondFilter ? []
      : filter === 'all' ? equities
      : equities.filter(e => e.name === filter)

    for (const eq of targetEquities) {
      for (const h of historyOf(eq.name).filter(h => h.date >= cutoffStr)) {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + h.total_value)
      }
    }

    const targetBonds = isBondFilter
      ? bonds.filter(b => b.isin === bondFilterIsin)
      : filter === 'all' ? bonds : []

    for (const bond of targetBonds) {
      for (const h of bondHistoryOf(bond.isin).filter(h => h.date >= cutoffStr)) {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + h.value)
      }
    }

    return Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ dateLabel: fmtDateShort(date), value }))
  }, [equities, historyOf, bonds, bondHistoryOf, filter, chartPeriod, isBondFilter, bondFilterIsin])

  const hasBonds = bonds.length > 0
  const color    = isBondOnly ? '#3b82f6' : '#ec4899'
  const gradId   = isBondOnly ? 'gBond' : 'gEq'

  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f9fafb', borderRadius: 8, fontSize: 10, padding: '4px 8px' }
    : { borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 10, padding: '4px 8px' }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">지분/장기투자</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{fmtKRW(totalValue)}</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 focus:outline-none dark:bg-gray-700 dark:text-gray-200"
          >
            <option value="all">전체 종목</option>
            {equities.length > 0 && (
              <optgroup label="지분(주식)">
                {equities.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
              </optgroup>
            )}
            {hasBonds && (
              <optgroup label="국채/채권">
                {bonds.map(b => <option key={b.isin} value={`bond_${b.isin}`}>{b.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* 주식 종목 목록 */}
      {displayedEquities.length > 0 && (
        <div className="space-y-1 mb-2 max-h-32 overflow-y-auto pr-0.5">
          {displayedEquities.map(eq => {
            const eqKey = `equity_${eq.name}`
            const isAct = activeKey === eqKey
            return (
              <div key={eq.name}
                onMouseEnter={() => onHover?.(eqKey)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onFocus?.(isAct ? null : eqKey)}
                className={`flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0 rounded px-1 cursor-pointer transition-colors ${
                  isAct ? 'bg-amber-50 dark:bg-amber-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{eq.name}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 rounded shrink-0">{eq.market}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{eq.price.toLocaleString()}원 · {eq.date}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 tabular-nums">{fmtKRW(eq.total_value)}</p>
                  {eq.returnRate !== null && (
                    <span className={`text-[10px] px-1.5 rounded font-medium ${returnBadgeClass(eq.returnRate)}`}>
                      {fmtReturn(eq.returnRate)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 국채 섹션 */}
      {displayedBonds.length > 0 && (
        <div className={`${displayedEquities.length > 0 ? 'border-t border-gray-100 dark:border-gray-700 pt-2 mt-1' : ''} mb-2`}>
          {displayedEquities.length > 0 && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium mb-1 px-1">국채/채권</p>
          )}
          <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
            {displayedBonds.map(b => {
              const ret = calcReturn(b.value, b.acquisition_cost)
              return (
                <div key={b.isin} className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0 rounded px-1 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-400 truncate">{b.name}</span>
                      <span className="text-[10px] text-blue-400 dark:text-blue-500 bg-blue-50 dark:bg-blue-950/30 px-1.5 rounded shrink-0">국채</span>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      {b.qty.toLocaleString()}좌 · 기준가 {b.price.toLocaleString()} · {b.priceDate}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums">{fmtKRW(b.value)}</p>
                    {ret !== null && (
                      <span className={`text-[10px] px-1.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                        {fmtReturn(ret)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 평가 추이 차트 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-400 dark:text-gray-500">평가 추이</p>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setChartPeriod(p.value)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  chartPeriod === p.value ? 'bg-pink-500 text-white' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {trendData.length < 2 ? (
          <div className="h-24 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
            {trendData.length === 0 ? '이력 데이터 없음' : '데이터 부족'}
          </div>
        ) : (() => {
          const values = trendData.map(d => d.value)
          const minV   = Math.min(...values)
          const maxV   = Math.max(...values)
          const spread = maxV - minV
          const range  = maxV > 0 ? spread / maxV : 1
          const yMin   = range < 0.05 ? Math.floor(minV * 0.995 / 1_0000) * 1_0000 : 0
          const yMax   = Math.ceil(maxV * 1.005 / 1_0000) * 1_0000
          const tickFmt = (v: number) => {
            const eo = v / 1_0000_0000
            return eo >= 10 ? `${eo.toFixed(0)}억` : `${eo.toFixed(1)}억`
          }
          return (
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={trendData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f3f4f6'} vertical={false} />
                <XAxis dataKey="dateLabel" tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }} tickFormatter={tickFmt} domain={[yMin, yMax]} width={44} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => [fmtKRW(Number(v)), isBondOnly ? '채권 평가금액' : '평가합계']}
                  contentStyle={tooltipStyle}
                  labelStyle={{ fontSize: 10 }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#${gradId})`}
                  dot={{ r: 2, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: color }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )
        })()}
      </div>
    </div>
  )
}
