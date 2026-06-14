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

type SeriesKey = 'operating' | 'investAvail' | 'investUnavail' | 'loan'
const ALL_SERIES: SeriesKey[] = ['operating', 'investAvail', 'investUnavail', 'loan']

export default function CashflowChart({ dailyRecords, investments, loans }: Props) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const [period, setPeriod] = useState<Period>(7)

  // 범례 선택: 빈 Set = 전체 표시. 클릭=단독, Ctrl/⌘+클릭=다중 토글
  const [selected, setSelected] = useState<Set<SeriesKey>>(new Set())
  const isVisible = (k: SeriesKey) => selected.size === 0 || selected.has(k)
  function toggleSeries(k: SeriesKey, multi: boolean) {
    setSelected(prev => {
      if (multi) {
        const next = new Set(prev.size === 0 ? ALL_SERIES : prev)
        if (next.has(k)) next.delete(k); else next.add(k)
        // 전체 선택과 동일해지면 빈 Set(=전체)로 정규화, 빈 Set이면 전체 복귀
        if (next.size === 0 || next.size === ALL_SERIES.length) return new Set()
        return next
      }
      // 단일 클릭: 이미 단독 선택된 항목 재클릭 시 전체 복귀
      if (prev.size === 1 && prev.has(k)) return new Set()
      return new Set([k])
    })
  }

  const chartData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - period)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const inRange = dailyRecords
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    const valueOf = (i: InvestmentRecord) =>
      i.product === '국채' && i.bondQty && i.bondPrice
        ? calcBondValue(i.bondQty, i.bondPrice)
        : (i.amount || 0)

    return inRange.map(d => {
      const operating =
        (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)

      const investsUpTo = investments.filter(
        i => (i.start || i.priceDate || '') <= d.date,
      )
      const latest = getLatestInvestments(investsUpTo)
      // 가용/불가용 분리 집계
      const investAvail   = latest.filter(i => i.available === '가용').reduce((s, i) => s + valueOf(i), 0)
      const investUnavail = latest.filter(i => i.available === '불가용').reduce((s, i) => s + valueOf(i), 0)

      const loan = loans.reduce((s, l) => s + (l.amount || 0), 0)

      return {
        dateLabel: fmtDateShort(d.date),
        opM:          Math.round(operating     / 1_0000),
        invAvailM:    Math.round(investAvail   / 1_0000),
        invUnavailM:  Math.round(investUnavail / 1_0000),
        loanM:        Math.round(loan          / 1_0000),
        opRaw:        operating,
        invAvailRaw:  investAvail,
        invUnavailRaw: investUnavail,
        invRaw:       investAvail + investUnavail,
        loanRaw:      loan,
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

      {/* 범례 (클릭=단독 / Ctrl·⌘+클릭=다중 토글 / 재클릭·전체해제=전체) */}
      <div className="shrink-0 flex items-center gap-1.5 mb-2 px-1 flex-wrap">
        {([
          { key: 'operating',     label: '운전자금',    swatch: <span className="inline-block w-3 h-2.5 rounded-sm bg-blue-500" /> },
          { key: 'investAvail',   label: '운용(가용)',  swatch: <span className="inline-block w-3 h-2.5 rounded-sm bg-emerald-500" /> },
          { key: 'investUnavail', label: '운용(불가용)', swatch: <span className="inline-block w-3 h-2.5 rounded-sm bg-emerald-300" /> },
          { key: 'loan',          label: '차입금',      swatch: <span className="inline-block w-4 border-t-2 border-dashed border-rose-400" /> },
        ] as { key: SeriesKey; label: string; swatch: React.ReactNode }[]).map(s => (
          <button
            key={s.key}
            onClick={e => toggleSeries(s.key, e.ctrlKey || e.metaKey)}
            title="클릭: 단독 보기 · Ctrl(⌘)+클릭: 다중 선택"
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all ${
              isVisible(s.key)
                ? 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700'
                : 'text-gray-300 dark:text-gray-600 opacity-50'
            }`}
          >
            {s.swatch}{s.label}
          </button>
        ))}
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-[10px] text-blue-500 hover:text-blue-700 px-1"
          >전체</button>
        )}
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
                      {isVisible('operating') && (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
                          <span className="text-gray-500 dark:text-gray-400">운전자금</span>
                          <span className="ml-auto font-medium tabular-nums">{fmtKRW(d.opRaw)}</span>
                        </div>
                      )}
                      {isVisible('investAvail') && (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />
                          <span className="text-gray-500 dark:text-gray-400">운용(가용)</span>
                          <span className="ml-auto font-medium tabular-nums">{fmtKRW(d.invAvailRaw)}</span>
                        </div>
                      )}
                      {isVisible('investUnavail') && (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="w-2 h-2 rounded-sm bg-emerald-300 inline-block" />
                          <span className="text-gray-500 dark:text-gray-400">운용(불가용)</span>
                          <span className="ml-auto font-medium tabular-nums">{fmtKRW(d.invUnavailRaw)}</span>
                        </div>
                      )}
                      {isVisible('loan') && (
                        <div className="flex items-center gap-2 text-[11px] border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
                          <span className="w-2 h-2 rounded-sm bg-rose-400 inline-block" />
                          <span className="text-gray-500 dark:text-gray-400">차입금</span>
                          <span className="ml-auto font-medium tabular-nums text-rose-600">{fmtKRW(d.loanRaw)}</span>
                        </div>
                      )}
                      {(() => {
                        const net =
                          (isVisible('operating')     ? d.opRaw        : 0) +
                          (isVisible('investAvail')   ? d.invAvailRaw  : 0) +
                          (isVisible('investUnavail') ? d.invUnavailRaw : 0) -
                          (isVisible('loan')          ? d.loanRaw      : 0)
                        const partial = selected.size > 0
                        return (
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="text-gray-400 dark:text-gray-500">{partial ? '선택 합계' : '순현금'}</span>
                            <span className={`ml-auto font-bold tabular-nums ${net >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-600'}`}>{fmtKRW(net)}</span>
                          </div>
                        )
                      })()}
                    </div>
                  )
                }}
                cursor={{ fill: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}
              />
              <ReferenceLine y={0} stroke={isDark ? '#374151' : '#e5e7eb'} strokeDasharray="4 2" />
              {isVisible('operating') && (
                <Bar dataKey="opM" name="운전자금" stackId="cash" fill="#3b82f6" fillOpacity={0.85} radius={[0,0,3,3]} maxBarSize={40} />
              )}
              {isVisible('investAvail') && (
                <Bar dataKey="invAvailM" name="운용(가용)" stackId="cash" fill="#10b981" fillOpacity={0.85} maxBarSize={40} />
              )}
              {isVisible('investUnavail') && (
                <Bar dataKey="invUnavailM" name="운용(불가용)" stackId="cash" fill="#6ee7b7" fillOpacity={0.9} radius={[3,3,0,0]} maxBarSize={40} />
              )}
              {isVisible('loan') && (
                <Line type="monotone" dataKey="loanM" name="차입금" stroke="#f87171" strokeWidth={1.8} strokeDasharray="5 3" dot={false} activeDot={{ r: 3, fill: '#f87171' }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
