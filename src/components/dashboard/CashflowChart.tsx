import { useState, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid,
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

/** 데이터 1포인트당 픽셀 — 막대 굵기를 일정하게 유지 */
const PX_PER_POINT = 40

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

  // ── 동적 최소 너비: 데이터 개수 × PX_PER_POINT, 최소 400px 보장
  const minChartWidth = Math.max(400, chartData.length * PX_PER_POINT)

  // ── X축 라벨 설정: 기간이 길수록 기울이고 간격을 늘림
  const xAngle       = period <= 30 ? 0 : -40
  const xHeight      = period <= 30 ? 22 : 48
  const xInterval    = period <= 7  ? 0
                     : period <= 30 ? 4
                     : period <= 90 ? 13   // ~주 2회
                     :                29   // ~월 1회

  return (
    <div className="bg-white rounded-xl shadow p-4 flex flex-col h-full">

      {/* 헤더 */}
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

      {/* 범례 안내 — ComposedChart 타입 설명 */}
      <div className="shrink-0 flex items-center gap-3 mb-2 px-1">
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="inline-block w-3 h-2 rounded-sm bg-blue-400 opacity-80" />Bar 운전자금
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="inline-block w-3 h-0.5 bg-emerald-400" style={{ borderTop: '2px dashed #34d399' }} />Area 운용자금
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="inline-block w-3 h-0.5 bg-rose-400" />Line 차입금
        </span>
      </div>

      {chartData.length < 2 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {chartData.length === 0 ? '데이터가 없습니다' : '데이터가 부족합니다 (최소 2일 필요)'}
        </div>
      ) : (
        // 가로 스크롤 컨테이너: overflow-x-auto + custom-scrollbar
        <div className="custom-scrollbar overflow-x-auto flex-1 min-h-0">
          {/* 최소 너비 = 데이터 개수 × PX_PER_POINT → 막대 굵기 일정 유지 */}
          <div style={{ minWidth: minChartWidth, height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 6, right: 8, left: -22, bottom: xHeight - 16 }}
                barGap={2}
                barCategoryGap="25%"
              >
                <defs>
                  {/* 운용자금 Area 그라디언트 */}
                  <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />

                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  interval={xInterval}
                  tickLine={false}
                  axisLine={false}
                  angle={xAngle}
                  textAnchor={xAngle !== 0 ? 'end' : 'middle'}
                  height={xHeight}
                />

                <YAxis
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickFormatter={v => `${(v / 10000).toFixed(0)}억`}
                  width={36}
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip
                  formatter={(v, name) => [fmtKRW(Number(v) * 1_0000), name]}
                  labelStyle={{ fontSize: 11, color: '#374151', fontWeight: 600 }}
                  contentStyle={{
                    fontSize: 11, borderRadius: 10,
                    border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }}
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                />

                <Legend
                  iconSize={8}
                  wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                  formatter={(value) => (
                    <span style={{ color: '#6b7280', fontSize: 10 }}>{value}</span>
                  )}
                />

                <ReferenceLine y={0} stroke="#e5e7eb" strokeDasharray="4 2" />

                {/* ① Bar — 운전자금 (일별 변동이 큰 현금) */}
                <Bar
                  dataKey="opM"
                  name="운전자금"
                  fill="#3b82f6"
                  fillOpacity={0.8}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                />

                {/* ② Area — 운용자금 (완만한 변동, 수준 파악용) */}
                <Area
                  type="monotone"
                  dataKey="invM"
                  name="운용자금"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  fill="url(#gradInv)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#10b981' }}
                />

                {/* ③ Line — 차입금 (총량 고정적, 추이 파악용) */}
                <Line
                  type="monotone"
                  dataKey="loanM"
                  name="차입금"
                  stroke="#f87171"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 3, fill: '#f87171' }}
                />

              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
