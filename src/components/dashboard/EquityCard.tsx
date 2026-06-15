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
  activeKey?:    string | null   // 외부 강조 (현재 미사용, 호환성 유지)
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
}: Props) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  // selected: 선택된 키 집합. 비어있으면 전체.
  // 키 규칙: 지분 → eq.name / 국채 → 'bond_' + isin
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [chartPeriod, setChartPeriod] = useState<Period>(7)

  const isAll = selected.size === 0

  // 클릭 핸들러 — Ctrl/Meta: 다중 토글 / 일반: 단일 선택(재클릭 시 해제)
  function handleItemClick(key: string, e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    } else {
      setSelected(prev =>
        prev.size === 1 && prev.has(key) ? new Set() : new Set([key])
      )
    }
  }

  const totalValue =
    equities.reduce((s, e) => s + (e.total_value || 0), 0) +
    bonds.reduce((s, b) => s + b.value, 0)

  // 차트에 쓸 대상 (선택 없으면 전체, 있으면 선택된 것만)
  const targetEquities = useMemo(() =>
    isAll ? equities : equities.filter(e => selected.has(e.name)),
  [equities, selected, isAll])

  const targetBonds = useMemo(() =>
    isAll ? bonds : bonds.filter(b => selected.has(`bond_${b.isin}`)),
  [bonds, selected, isAll])

  // 선택 항목이 모두 국채일 때 → 파란색 테마
  const isBondOnly = !isAll && targetEquities.length === 0 && targetBonds.length > 0

  const trendData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - chartPeriod)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const dateMap = new Map<string, number>()

    for (const eq of targetEquities) {
      for (const h of historyOf(eq.name).filter(h => h.date >= cutoffStr)) {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + h.total_value)
      }
    }
    for (const bond of targetBonds) {
      for (const h of bondHistoryOf(bond.isin).filter(h => h.date >= cutoffStr)) {
        dateMap.set(h.date, (dateMap.get(h.date) ?? 0) + h.value)
      }
    }

    return Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ dateLabel: fmtDateShort(date), value }))
  }, [targetEquities, targetBonds, historyOf, bondHistoryOf, chartPeriod])

  const hasBonds = bonds.length > 0
  const color    = isBondOnly ? '#3b82f6' : '#ec4899'
  const gradId   = isBondOnly ? 'gBond' : 'gEq'

  // 차트 헤더용 선택 요약 텍스트
  const selectionLabel = useMemo(() => {
    if (isAll) return null
    const names = [
      ...targetEquities.map(e => e.name),
      ...targetBonds.map(b => b.name),
    ]
    if (names.length === 1) return names[0]
    if (names.length <= 3) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}건`
  }, [isAll, targetEquities, targetBonds])

  const tooltipStyle = isDark
    ? { backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f9fafb', borderRadius: 8, fontSize: 10, padding: '4px 8px' }
    : { borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 10, padding: '4px 8px' }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-100">지분/장기투자</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{fmtKRW(totalValue)}</span>
          {!isAll && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full leading-none"
              title="전체 종목으로 돌아가기"
            >
              ✕ 전체
            </button>
          )}
        </div>
      </div>

      {/* 종목 목록 — 항상 전체 표시, 고정 높이 스크롤 */}
      <div className="h-44 overflow-y-auto mb-3 space-y-0.5 pr-0.5">

        {/* 지분(주식) */}
        {equities.map(eq => {
          const isSelected = selected.has(eq.name)
          return (
            <div key={eq.name}
              onClick={e => handleItemClick(eq.name, e)}
              className={`flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-slate-700/60 last:border-0 rounded px-1 cursor-pointer select-none transition-colors ${
                isSelected
                  ? 'bg-pink-50 dark:bg-pink-900/20 ring-1 ring-inset ring-pink-200 dark:ring-pink-700'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{eq.name}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-slate-700 px-1.5 rounded shrink-0">{eq.market}</span>
                  {isSelected && <span className="text-[9px] text-pink-500 font-bold shrink-0">▶ 차트</span>}
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

        {/* 구분선 — 지분과 국채 모두 있을 때 */}
        {equities.length > 0 && hasBonds && (
          <div className="flex items-center gap-1.5 py-1 px-1">
            <div className="flex-1 h-px bg-gray-100 dark:bg-slate-700" />
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium shrink-0">국채/채권</span>
            <div className="flex-1 h-px bg-gray-100 dark:bg-slate-700" />
          </div>
        )}

        {/* 국채 */}
        {bonds.map(b => {
          const ret  = calcReturn(b.value, b.acquisition_cost)
          const bKey = `bond_${b.isin}`
          const isSelected = selected.has(bKey)
          return (
            <div key={b.isin}
              onClick={e => handleItemClick(bKey, e)}
              className={`flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-slate-700/60 last:border-0 rounded px-1 cursor-pointer select-none transition-colors ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-inset ring-blue-200 dark:ring-blue-700'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-400 truncate">{b.name}</span>
                  <span className="text-[10px] text-blue-400 dark:text-blue-500 bg-blue-50 dark:bg-blue-950/30 px-1.5 rounded shrink-0">국채</span>
                  {isSelected && <span className="text-[9px] text-blue-500 font-bold shrink-0">▶ 차트</span>}
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

        {/* 항목 없음 */}
        {equities.length === 0 && bonds.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400 dark:text-gray-500">
            데이터 없음
          </div>
        )}
      </div>

      {/* 평가 추이 차트 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[55%]">
            평가 추이
            {selectionLabel && (
              <span className="ml-1 text-gray-300 dark:text-gray-600">— {selectionLabel}</span>
            )}
          </p>
          <div className="flex gap-1 shrink-0">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setChartPeriod(p.value)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  chartPeriod === p.value
                    ? (isBondOnly ? 'bg-blue-500 text-white' : 'bg-pink-500 text-white')
                    : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 복수 선택 힌트 */}
        {isAll && (equities.length + bonds.length) > 1 && (
          <p className="text-[10px] text-gray-300 dark:text-gray-600 mb-1">
            Ctrl+클릭으로 복수 선택
          </p>
        )}

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

