import { useState, useMemo } from 'react'
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { fmtKRW, fmtDateShort, calcBondValue } from '../../lib/format'
import { getLatestInvestments } from '../../hooks/useInvestments'
import type { DailyRecord, InvestmentRecord, LoanRecord } from '../../types'

interface Props {
  dailyRecords:   DailyRecord[]
  investments:    InvestmentRecord[]
  loans:          LoanRecord[]
}

type Period = 7 | 14 | 30 | 90
const PERIODS: { label: string; value: Period }[] = [
  { label: '7일',  value: 7  },
  { label: '14일', value: 14 },
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
]

export default function CashflowChart({ dailyRecords, investments, loans }: Props) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const [period, setPeriod] = useState<Period>(7)

  const chartData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - period)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const inRange = dailyRecords
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    return inRange.map(d => {
      const operating =
        (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)

      const investsUpTo = investments.filter(
        i => (i.start || i.priceDate || '') <= d.date,
      )
      const latest = getLatestInvestments(investsUpTo)
      const invest = latest.reduce((s, i) => {
        const v = i.product === '국채' && i.bondQty && i.bondPrice
          ? calcBondValue(i.bondQty, i.bondPrice)
          : (i.amount || 0)
        return s + v
      }, 0)

      const loan = loans.reduce((s, l) => s + (l.amount || 0), 0)

      return {
        dateLabel: fmtDateShort(d.date),
        opM:     Math.round(operating / 1_0000),
        invM:    Math.round(invest    / 1_0000),
        loanM:   Math.round(loan      / 1_0000),
        opRaw:   operating,
        invRaw:  invest,
        loanRaw: loan,
      }
    })
  }, [dailyRecords, investments, loans, period])

  const xInterval =
    period <= 7  ? 0 :
    period <= 14 ? 1 :
    period <= 30 ? 3 : 13

  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f9fafb', borderRadius: 10, fontSize: 11 }
    : { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 11 }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex flex-col h-full">

      {/* 헤더 */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          현금흐름 추이
        </h3>
        <div className="flex gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                period === p.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 범례 */}
      <div className="shrink-0 flex items-center gap-3 mb-2 px-1">
        <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-blue-400" />운전자금
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-emerald-400" />운용자금
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <span className="inline-block w-4 border-t-2 border-dashed border-rose-400" />차입금
        </span>
      </div>

      {chartData.length < 2 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
          {chartData.length === 0 ? '데이터가 없습니다' : '데이터가 부족합니다 (최소 2일 필요)'}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 6, right: 8, left: -18, bottom: 4 }}
              barCategoryGap="30%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f3f4f6'} vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#9ca3af' }}
                interval={xInterval}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }}
                tickFormatter={v => {
                  const n = v / 10000
                  return n >= 1000 ? `${(n / 1000).toFixed(0)}천억` : `${n.toFixed(0)}억`
                }}
                width={52}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, label, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload as typeof chartData[0]
                  return (
                    <div style={tooltipStyle} className="px-3 py-2 space-y-1">
                      <p className="font-semibold text-[11px] mb-1.5">{label}</p>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />
                        <span className="text-gray-500 dark:text-gray-400">운전자금</span>
                        <span className="ml-auto font-medium tabular-nums">{fmtKRW(d.opRaw)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />
                        <span className="text-gray-500 dark:text-gray-400">운용자금</span>
                        <span className="ml-auto font-medium tabular-nums">{fmtKRW(d.invRaw)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
                        <span className="w-2 h-2 rounded-sm bg-rose-400 inline-block" />
                        <span className="text-gray-500 dark:text-gray-400">차입금</span>
                        <span className="ml-auto font-medium tabular-nums text-rose-600">{fmtKRW(d.loanRaw)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-gray-400 dark:text-gray-500">순현금</span>
                        <span className={`ml-auto font-bold tabular-nums ${
                          (d.opRaw + d.invRaw - d.loanRaw) >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-600'
                        }`}>{fmtKRW(d.opRaw + d.invRaw - d.loanRaw)}</span>
                      </div>
                    </div>
                  )
                }}
                cursor={{ fill: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}
              />
              <ReferenceLine y={0} stroke={isDark ? '#374151' : '#e5e7eb'} strokeDasharray="4 2" />
              <Bar dataKey="opM"  name="운전자금" stackId="cash" fill="#3b82f6" fillOpacity={0.85} radius={[0,0,3,3]} maxBarSize={40} />
              <Bar dataKey="invM" name="운용자금" stackId="cash" fill="#10b981" fillOpacity={0.80} radius={[3,3,0,0]} maxBarSize={40} />
              <Line type="monotone" dataKey="loanM" name="차입금" stroke="#f87171" strokeWidth={1.8} strokeDasharray="5 3" dot={false} activeDot={{ r: 3, fill: '#f87171' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
