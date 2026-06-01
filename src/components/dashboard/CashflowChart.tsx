import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
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

interface ChartPoint {
  date: string
  dateLabel: string
  operating: number
  invest: number
  loan: number
}

export default function CashflowChart({ dailyRecords, investments, loans }: Props) {
  const [period, setPeriod] = useState<Period>(30)

  const chartData = useMemo<ChartPoint[]>(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - period)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    // 기간 내 날짜 집합
    const dailyInRange = dailyRecords
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    return dailyInRange.map(d => {
      const operating = (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)

      // 해당 날짜 기준 운용자금 최신 1건 (날짜 이하 레코드만 필터)
      const investsUpToDate = investments.filter(i => {
        const startDate = i.start || i.priceDate || ''
        return startDate <= d.date
      })
      const latest = getLatestInvestments(investsUpToDate)
      const invest = latest.reduce((s, i) => {
        const v = i.product === '국채' && i.bondQty && i.bondPrice
          ? calcBondValue(i.bondQty, i.bondPrice)
          : (i.amount || 0)
        return s + v
      }, 0)

      const loan = loans.reduce((s, l) => s + (l.amount || 0), 0)

      return {
        date: d.date,
        dateLabel: fmtDateShort(d.date),
        operating: Math.round(operating / 1_0000),   // 만원 단위
        invest:    Math.round(invest    / 1_0000),
        loan:      Math.round(loan      / 1_0000),
      }
    })
  }, [dailyRecords, investments, loans, period])

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600">현금흐름 추이</h3>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                period === p.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-gray-400">
          데이터가 없습니다
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gOp"  x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gLoan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={v => `${(v / 10000).toFixed(0)}억`}
              width={45}
            />
            <Tooltip
              formatter={(v) => fmtKRW(Number(v) * 1_0000)}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="operating" name="운전자금" stroke="#3b82f6" fill="url(#gOp)"   strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="invest"    name="운용자금" stroke="#10b981" fill="url(#gInv)"  strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="loan"      name="차입금"   stroke="#ef4444" fill="url(#gLoan)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
