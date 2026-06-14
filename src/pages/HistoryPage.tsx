import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { useDaily } from '../hooks/useDaily'
import { useInvestments, getLatestInvestments } from '../hooks/useInvestments'
import { useLoans } from '../hooks/useLoans'
import { fmtKRW, fmtDateShort, calcBondValue } from '../lib/format'
import { getCompanyNames } from '../hooks/useCompanies'
import type { Company } from '../types'

type Period = 7 | 30 | 90 | 365
const PERIODS: { label: string; value: Period }[] = [
  { label: '7일',  value: 7   },
  { label: '30일', value: 30  },
  { label: '90일', value: 90  },
  { label: '1년',  value: 365 },
]

interface HistoryRow {
  date: string
  dateLabel: string
  operating: number
  invest: number
  loan: number
  net: number
  writer?: string
}

export default function HistoryPage() {
  const { company: paramCompany, from: paramFrom, to: paramTo } =
    useParams<{ company?: string; from?: string; to?: string }>()
  const { user, setCurrentCompany } = useAuth()

  const daily = useDaily()
  const inv   = useInvestments()
  const loans = useLoans(true)  // active only

  const [period, setPeriod] = useState<Period>(30)
  const [view, setView]     = useState<'chart' | 'table'>('table')

  useEffect(() => {
    if (!paramCompany || user?.role === 'company') return
    if (getCompanyNames().includes(paramCompany)) setCurrentCompany(paramCompany as Company)
  }, [paramCompany, user?.role, setCurrentCompany])

  // URL 파라미터로 날짜 범위 지정 시 맞는 Period 선택
  useEffect(() => {
    if (paramFrom && paramTo) {
      const diffDays = Math.round(
        (new Date(paramTo).getTime() - new Date(paramFrom).getTime()) / 86_400_000
      )
      const matched = ([7, 30, 90, 365] as Period[]).find(p => p >= diffDays) ?? 365
      setPeriod(matched)
    }
  }, [paramFrom, paramTo])

  // 차입금 합계 (active)
  const totalLoan = useMemo(
    () => loans.data.reduce((s, l) => s + l.amount, 0),
    [loans.data]
  )

  // 날짜별 행 계산
  const rows = useMemo<HistoryRow[]>(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - period)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const dailyInRange = daily.data
      .filter(d => d.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    return dailyInRange.map(d => {
      // 운전자금
      const operating =
        (d.krw_demand || 0) + (d.krw_govt || 0) + (d.krw_mmda || 0) + (d.fx_krw || 0)

      // 운용자금: 해당 날짜 이하 레코드 기준 최신 집계
      const investsUpTo = inv.data.filter(i => {
        // 채권은 priceDate(시세 기준일) 우선, 비채권은 start(운용 시작일) 우선
        const dt = i.product === '국채'
          ? (i.priceDate || i.start || '')
          : (i.start || i.priceDate || '')
        return dt !== '' && dt <= d.date
      })
      const latest = getLatestInvestments(investsUpTo)
      const invest = latest.reduce((s, i) => {
        const v = i.product === '국채' && i.bondQty && i.bondPrice
          ? calcBondValue(i.bondQty, i.bondPrice)
          : (i.amount || 0)
        return s + v
      }, 0)

      return {
        date:      d.date,
        dateLabel: fmtDateShort(d.date),
        operating,
        invest,
        loan:    totalLoan,
        net:     operating + invest - totalLoan,
        writer:  d.writer,
      }
    })
  }, [daily.data, inv.data, totalLoan, period])

  const loading = daily.loading || inv.loading || loans.loading

  // 차트용 만원 단위
  const chartData = useMemo(() =>
    rows.map(r => ({
      ...r,
      opM:    Math.round(r.operating / 10_000),
      invM:   Math.round(r.invest    / 10_000),
      loanM:  Math.round(r.loan      / 10_000),
      netM:   Math.round(r.net       / 10_000),
    })),
  [rows])

  // 최신/최고/최저 요약
  const latest = rows[rows.length - 1]
  const maxNet = rows.length ? Math.max(...rows.map(r => r.net)) : 0
  const minNet = rows.length ? Math.min(...rows.map(r => r.net)) : 0

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">자금 변동 이력</h2>
        <div className="flex items-center gap-2">
          {/* 기간 탭 */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  period === p.value
                    ? 'bg-white dark:bg-gray-700 text-blue-700 font-semibold shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {/* 보기 전환 */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {(['table', 'chart'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  view === v
                    ? 'bg-white dark:bg-gray-700 text-blue-700 font-semibold shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}>
                {v === 'table' ? '📋 표' : '📈 차트'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 요약 KPI */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 dark:bg-blue-950/30 dark:border-blue-800">
            <p className="text-xs text-blue-600 font-medium mb-1 dark:text-blue-400">최근 운전자금</p>
            <p className="text-lg font-bold text-blue-800 dark:text-blue-300">{fmtKRW(latest.operating)}</p>
            <p className="text-xs text-blue-400 mt-1 dark:text-blue-500">{latest.date}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
            <p className="text-xs text-emerald-600 font-medium mb-1 dark:text-emerald-400">최근 운용자금</p>
            <p className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{fmtKRW(latest.invest)}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 dark:bg-red-950/30 dark:border-red-800">
            <p className="text-xs text-red-500 font-medium mb-1 dark:text-red-400">차입금</p>
            <p className="text-lg font-bold text-red-800 dark:text-red-300">{fmtKRW(latest.loan)}</p>
          </div>
          <div className={`border rounded-xl p-4 ${latest.net >= 0
            ? 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
            : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
            <p className={`text-xs font-medium mb-1 ${latest.net >= 0 ? 'text-gray-600 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}`}>
              순현금 포지션
            </p>
            <p className={`text-lg font-bold ${latest.net >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-800 dark:text-red-300'}`}>
              {fmtKRW(latest.net)}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              최고 {fmtKRW(maxNet)} / 최저 {fmtKRW(minNet)}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center text-sm text-gray-400 dark:text-gray-500">
          로딩 중...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center text-sm text-gray-400 dark:text-gray-500">
          해당 기간에 데이터가 없습니다.
        </div>
      ) : (
        <>
          {/* 차트 뷰 */}
          {view === 'chart' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">
                현금흐름 추이 ({rows[0]?.date} ~ {rows[rows.length - 1]?.date})
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    {[
                      { id: 'gOp',   color: '#3b82f6' },
                      { id: 'gInv',  color: '#10b981' },
                      { id: 'gLoan', color: '#ef4444' },
                      { id: 'gNet',  color: '#8b5cf6' },
                    ].map(g => (
                      <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={g.color} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={g.color} stopOpacity={0}   />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f0f0f0'} />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: isDark ? '#9ca3af' : undefined }} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 10, fill: isDark ? '#9ca3af' : undefined }}
                    tickFormatter={v => `${(v / 10000).toFixed(0)}억`}
                    width={48}
                  />
                  <Tooltip
                    formatter={(v) => fmtKRW(Number(v) * 10_000)}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{
                      fontSize: 12,
                      backgroundColor: isDark ? '#1f2937' : undefined,
                      borderColor: isDark ? '#374151' : undefined,
                      color: isDark ? '#f3f4f6' : undefined,
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="opM"   name="운전자금" stroke="#3b82f6" fill="url(#gOp)"   strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="invM"  name="운용자금" stroke="#10b981" fill="url(#gInv)"  strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="loanM" name="차입금"   stroke="#ef4444" fill="url(#gLoan)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="netM"  name="순현금"   stroke="#8b5cf6" fill="url(#gNet)"  strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* 표 뷰 */}
          {view === 'table' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      {['기준일', '운전자금', '운용자금', '차입금', '순현금 포지션', '전일 대비', '작성자'].map(h => (
                        <th key={h}
                          className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium px-5 py-3 whitespace-nowrap first:pl-5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].reverse().map((row, i, arr) => {
                      const prev = arr[i + 1]
                      const diff = prev ? row.net - prev.net : null
                      return (
                        <tr key={row.date} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-5 py-3 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
                            {row.date}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-blue-700 dark:text-blue-400">
                            {fmtKRW(row.operating)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {fmtKRW(row.invest)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-red-600 dark:text-red-400">
                            {fmtKRW(row.loan)}
                          </td>
                          <td className={`px-5 py-3 text-right tabular-nums font-semibold ${
                            row.net >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'
                          }`}>
                            {fmtKRW(row.net)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {diff !== null ? (
                              <span className={`text-xs font-medium ${
                                diff > 0 ? 'text-red-500' :
                                diff < 0 ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
                              }`}>
                                {diff > 0 ? '▲' : diff < 0 ? '▼' : '─'}{' '}
                                {diff !== 0 ? fmtKRW(Math.abs(diff)) : '-'}
                              </span>
                            ) : <span className="text-gray-300 dark:text-gray-600">-</span>}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">{row.writer}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
