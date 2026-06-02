import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import { fmtKRW, fmtDateShort, calcBondValue } from '../../lib/format'
import { getLatestInvestments } from '../../hooks/useInvestments'
import type { DailyRecord, InvestmentRecord, LoanRecord } from '../../types'

interface Props {
  dailyRecords:   DailyRecord[]
  investments:    InvestmentRecord[]
  loans:          LoanRecord[]
}

type Period = 7 | 30 | 90 | 365
const PERIODS: { label: string; value: Period }[] = [
  { label: '7일',  value: 7   },
  { label: '30일', value: 30  },
  { label: '90일', value: 90  },
  { label: '1년',  value: 365 },
]

export default function CashflowChart({ dailyRecords, investments, loans }: Props) {
  const [period, setPeriod] = useState<Period>(30)

  const chartData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - period)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const inRange = dailyRecords
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    return inRange.map(d => {
      const operating = (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)

      const investsUpTo = investments.filter(i => (i.start || i.priceDate || '') <= d.date)
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
        opM:   Math.round(operating / 1_0000),
        invM:  Math.round(invest    / 1_0000),
        loanM: Math.round(loan      / 1_0000),
      }
    })
  }, [dailyRecords, investments, loans, period])

  return (
    // flex flex-col h-full: 그리드 stretch로 EquityCard와 동일 높이 유지
    <div className="bg-white rounded-xl shadow p-4 flex flex-col h-full">

      {/* 헤더 — shrink-0으로 고정 */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">현금흐름 추이</h3>
        <div className="flex gap-0.5">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                period === p.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 차트 영역 — flex-1 min-h-0: 카드 남은 높이를 꽉 채움 */}
      <div className="flex-1 min-h-0">
        {chartData.length < 2 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            {chartData.length === 0 ? '데이터가 없습니다' : '데이터가 부족합니다 (최소 2일 필요)'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
              barGap={1}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                tickFormatter={v => `${(v / 10000).toFixed(0)}억`}
                width={36}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => fmtKRW(Number(v) * 1_0000)}
                labelStyle={{ fontSize: 11 }}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              />
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
              />
              <ReferenceLine y={0} stroke="#e5e7eb" />
              <Bar dataKey="opM"   name="운전자금" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={28} />
              <Bar dataKey="invM"  name="운용자금" fill="#10b981" radius={[2, 2, 0, 0]} maxBarSize={28} />
              <Bar dataKey="loanM" name="차입금"   fill="#f87171" radius={[2, 2, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
