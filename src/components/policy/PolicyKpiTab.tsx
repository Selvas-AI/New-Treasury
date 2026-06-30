import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, CartesianGrid,
} from 'recharts'
import { restSelect } from '../../lib/supabase'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { usePolicyMeetings } from '../../hooks/usePolicyMeetings'
import { useFx } from '../../hooks/useFx'
import { fmtKRW, calcBondValue } from '../../lib/format'
import type { PolicyDecision, PolicyMeeting } from '../../types'

interface Props {
  company: string
  isMaster: boolean
}

interface DailyRow {
  date: string
  fx_usd: number
  fx_eur: number
  fx_jpy: number
  fx_gbp: number
  fx_cny: number
}

interface InvRow {
  id: string
  product: string
  bank: string
  amount: number
  currency: string
  bondQty: number | null
  bondPrice: number | null
  start: string
  end: string | null
  active: boolean
  available: string
  bond_name?: string
}

const Z_MAP: Record<number, number> = { 90: 1.2816, 95: 1.6503, 99: 2.3263 }
const RATE_BPS = [-100, -50, -25, +25, +50, +100]

const FX_KEYWORDS = ['환전', 'FX', '외화', '헤지', 'hedge', '환율', '달러', 'USD', 'EUR']
const BOND_KEYWORDS = ['국채', '채권', 'exit', '매도', '상환', 'FVPL', '금리', 'duration', '듀레이션']

function fmtEok(won: number) {
  const v = Math.round(won / 1e8 * 10) / 10
  return `${v.toLocaleString()}억원`
}

// 천 단위로 외화 표시
function fmtFx(val: number, code: string) {
  if (!val) return '-'
  return `${code.toUpperCase()} ${Math.round(val).toLocaleString()}`
}

// ── 범례 커스텀 ──
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-slate-300">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

// ── 비교 수치 카드 ──
function CmpCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' | 'blue' }) {
  const cls = highlight === 'green' ? 'text-emerald-600 dark:text-emerald-400'
    : highlight === 'red' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-800 dark:text-slate-100'
  return (
    <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4 flex flex-col gap-1">
      <div className="text-xs text-gray-400 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 dark:text-slate-500">{sub}</div>}
    </div>
  )
}

export default function PolicyKpiTab({ company }: Props) {
  const params   = usePolicyParams(company)
  const meetings = usePolicyMeetings()
  const fx       = useFx()

  // PolicyKpiTab은 Sidebar와 별개 useFx 인스턴스 — 직접 fetchRates 호출 필요
  useEffect(() => { void fx.fetchRates() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [dailyHistory, setDailyHistory]     = useState<DailyRow[]>([])
  const [allBonds, setAllBonds]             = useState<InvRow[]>([])
  const [allDecisions, setAllDecisions]     = useState<PolicyDecision[]>([])
  const [loadingData, setLoadingData]       = useState(false)

  // 접기/펼치기
  const [fxOpen, setFxOpen]     = useState(true)
  const [bondOpen, setBondOpen] = useState(true)

  // 기준일: null=자동, string=수동 오버라이드
  const [baseDateFx, setBaseDateFx]         = useState<string | null>(null)
  const [baseDateBond, setBaseDateBond]     = useState<string | null>(null)

  // ── 데이터 로드 ──
  useEffect(() => {
    if (!company) return
    setLoadingData(true)
    void Promise.all([
      restSelect<DailyRow>('daily', {
        match: { company },
        order: 'date.asc',
        limit: 400,
      }),
      restSelect<InvRow>('investments', {
        match: { company, product: '국채' },
        order: 'start.asc',
        limit: 200,
      }),
      restSelect<PolicyDecision>('policy_decisions', {
        match: { company },
        order: 'created_at.asc',
        limit: 200,
      }),
    ]).then(([dr, ir, decr]) => {
      setDailyHistory(dr.data ?? [])
      setAllBonds(ir.data ?? [])
      setAllDecisions(decr.data ?? [])
    }).finally(() => setLoadingData(false))
  }, [company])

  // ── 자동 기준일: 의결사항 회의 날짜 ──
  const autoBaseDate = useMemo(() => {
    const meetingMap: Record<string, PolicyMeeting> = {}
    meetings.data.forEach(m => { meetingMap[m.id] = m })

    // FX 관련 의결사항이 있는 가장 이른 회의 날짜
    const fxDec = allDecisions.filter(d =>
      FX_KEYWORDS.some(k => d.title?.includes(k) || d.decision?.includes(k))
    )
    const fxDate = fxDec
      .map(d => meetingMap[d.meeting_id]?.held_at)
      .filter(Boolean)
      .sort()[0] ?? null

    // 국채 Exit 관련 가장 이른 회의 날짜
    const bondDec = allDecisions.filter(d =>
      BOND_KEYWORDS.some(k => d.title?.includes(k) || d.decision?.includes(k))
    )
    const bondDate = bondDec
      .map(d => meetingMap[d.meeting_id]?.held_at)
      .filter(Boolean)
      .sort()[0] ?? null

    return { fx: fxDate, bond: bondDate }
  }, [allDecisions, meetings.data])

  const effectiveFxDate   = baseDateFx   ?? autoBaseDate.fx   ?? dailyHistory[0]?.date
  const effectiveBondDate = baseDateBond ?? autoBaseDate.bond ?? allBonds[0]?.start

  // ── FX 분석 ──
  const fxAnalysis = useMemo(() => {
    if (!dailyHistory.length) return null
    const { toKRW: fxToKRW } = fx

    const baseRec    = dailyHistory.find(d => d.date >= (effectiveFxDate ?? '')) ?? dailyHistory[0]
    const currentRec = dailyHistory[dailyHistory.length - 1]

    const rowKRW = (r: DailyRow) =>
      fxToKRW(r.fx_usd, 'USD')
      + fxToKRW(r.fx_eur, 'EUR')
      + fxToKRW(r.fx_jpy, 'JPY')
      + fxToKRW(r.fx_gbp, 'GBP')
      + fxToKRW(r.fx_cny, 'CNY')

    const baseKRW    = rowKRW(baseRec)
    const currentKRW = rowKRW(currentRec)

    const confLevel = Number(params.get('fx_conf_level') ?? 95)
    const z = Z_MAP[confLevel] ?? 1.6503

    const stdUsd = Number(params.get('fx_std_usd') ?? 0.08)
    const stdEur = Number(params.get('fx_std_eur') ?? 0.09)
    const stdJpy = Number(params.get('fx_std_jpy') ?? 0.10)
    const stdGbp = Number(params.get('fx_std_gbp') ?? 0.09)
    const stdCny = Number(params.get('fx_std_cny') ?? 0.05)

    const rowMaxLoss = (r: DailyRow) => (
      fxToKRW(r.fx_usd, 'USD') * stdUsd
      + fxToKRW(r.fx_eur, 'EUR') * stdEur
      + fxToKRW(r.fx_jpy, 'JPY') * stdJpy
      + fxToKRW(r.fx_gbp, 'GBP') * stdGbp
      + fxToKRW(r.fx_cny, 'CNY') * stdCny
    ) * z

    const maxLossBase    = rowMaxLoss(baseRec)
    const maxLossCurrent = rowMaxLoss(currentRec)

    const saving = maxLossBase - maxLossCurrent
    const savingPct = maxLossBase > 0 ? saving / maxLossBase * 100 : 0

    // 월별 추이 (마지막 12개 월별 샘플)
    const monthlyMap: Record<string, DailyRow> = {}
    dailyHistory.forEach(d => {
      const m = d.date.slice(0, 7)
      monthlyMap[m] = d
    })
    const trend = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([month, rec]) => ({
        month,
        krw: Math.round(rowKRW(rec) / 1e8 * 10) / 10,
      }))

    return {
      baseRec, currentRec, baseKRW, currentKRW,
      maxLossBase, maxLossCurrent, saving, savingPct,
      confLevel, trend,
    }
  }, [dailyHistory, fx.rates, params, effectiveFxDate])

  // ── 국채 Exit 분석 ──
  const bondAnalysis = useMemo(() => {
    if (!allBonds.length) return null

    const today = new Date().toISOString().slice(0, 10)
    const current = allBonds.filter(b => b.active !== false && !(b.end && b.end <= today))
    const exited  = allBonds.filter(b => b.active === false || (b.end && b.end <= today))

    // 기준일 이후 exit된 것만
    const relevantExited = effectiveBondDate
      ? exited.filter(b => (b.end ?? '') >= effectiveBondDate)
      : exited

    const currentValue     = current.reduce((s, b) => s + calcBondValue(b.bondQty ?? 0, b.bondPrice ?? 0), 0)
    const exitedValue      = relevantExited.reduce((s, b) => s + calcBondValue(b.bondQty ?? 0, b.bondPrice ?? 0), 0)
    const hypotheticalValue = currentValue + exitedValue

    const duration = Number(params.get('duration') ?? 0)

    // 금리 시나리오별 ΔPrice (억원)
    const scenarios = RATE_BPS.map(bp => {
      const dr = -duration * (bp / 10000)  // ΔP/P = -D × Δy
      return {
        label: `${bp > 0 ? '+' : ''}${bp}bp`,
        현재: Math.round(dr * currentValue / 1e8 * 10) / 10,
        미실행시: Math.round(dr * hypotheticalValue / 1e8 * 10) / 10,
      }
    })

    // +100bp 기준 절감
    const bpP100 = scenarios.find(s => s.label === '+100bp')!
    const saving100 = bpP100.미실행시 - bpP100.현재  // 둘 다 음수 → 미실행이 더 크게 음수 → 차이는 양수가 절감

    return {
      current, exited, relevantExited,
      currentValue, exitedValue, hypotheticalValue,
      duration, scenarios, saving100,
    }
  }, [allBonds, params, effectiveBondDate])

  if (loadingData || meetings.loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 dark:text-slate-400 text-sm">
        데이터 불러오는 중…
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* ── 섹션 1: FX 환전 효과 ─────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <button
          onClick={() => setFxOpen(o => !o)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-slate-100">💱 FX 환전 효과 분석</h3>
            <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
              환전을 실행하지 않았다면 노출됐을 환율 변동성과 현재 절감 효과를 비교합니다.
            </p>
          </div>
          <span className={`text-gray-400 dark:text-slate-400 text-lg transition-transform duration-200 ${fxOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {fxOpen && <div className="px-6 pb-6 space-y-5">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* 기준일 선택 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 dark:text-slate-400">기준일</span>
            {baseDateFx === null && autoBaseDate.fx ? (
              <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                자동: {autoBaseDate.fx}
              </span>
            ) : null}
            <input
              type="date"
              value={effectiveFxDate ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setBaseDateFx(e.target.value || null)}
              className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {baseDateFx && (
              <button
                onClick={() => setBaseDateFx(null)}
                className="text-xs text-blue-500 hover:underline"
              >
                자동으로
              </button>
            )}
          </div>
        </div>

        {fxAnalysis ? (
          <>
            {/* 비교 카드 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CmpCard
                label={`환전 전 외화 (${effectiveFxDate})`}
                value={fmtEok(fxAnalysis.baseKRW)}
                sub={[
                  fxAnalysis.baseRec.fx_usd && fmtFx(fxAnalysis.baseRec.fx_usd, 'USD'),
                  fxAnalysis.baseRec.fx_eur && fmtFx(fxAnalysis.baseRec.fx_eur, 'EUR'),
                  fxAnalysis.baseRec.fx_jpy && fmtFx(fxAnalysis.baseRec.fx_jpy, 'JPY'),
                ].filter(Boolean).join(' · ')}
              />
              <CmpCard
                label={`현재 외화 (${fxAnalysis.currentRec?.date})`}
                value={fmtEok(fxAnalysis.currentKRW)}
                sub={[
                  fxAnalysis.currentRec?.fx_usd && fmtFx(fxAnalysis.currentRec.fx_usd, 'USD'),
                  fxAnalysis.currentRec?.fx_eur && fmtFx(fxAnalysis.currentRec.fx_eur, 'EUR'),
                  fxAnalysis.currentRec?.fx_jpy && fmtFx(fxAnalysis.currentRec.fx_jpy, 'JPY'),
                ].filter(Boolean).join(' · ')}
              />
              <CmpCard
                label={`환전 전 최대 예상 손실 (Z${fxAnalysis.confLevel})`}
                value={`▼ ${fmtEok(fxAnalysis.maxLossBase)}`}
                sub="외화 잔고 × 연환산 σ × Z95"
                highlight="red"
              />
              <CmpCard
                label="환전 후 최대 예상 손실"
                value={`▼ ${fmtEok(fxAnalysis.maxLossCurrent)}`}
                sub={`절감 효과: ${fmtEok(fxAnalysis.saving)} (${fxAnalysis.savingPct.toFixed(0)}% ↓)`}
                highlight="green"
              />
            </div>

            {/* 절감 효과 강조 배너 */}
            {fxAnalysis.saving > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-5 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                ✅ 환전 실행으로 환율 변동 최대 예상 손실을 <strong>{fmtEok(fxAnalysis.saving)}</strong> ({fxAnalysis.savingPct.toFixed(0)}%) 줄였습니다.
              </div>
            )}
            {fxAnalysis.saving <= 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-5 py-3 text-sm text-amber-800 dark:text-amber-300">
                ⚠ 기준일 이후 외화 잔고가 증가했습니다. 환전 실행 계획을 검토하세요.
              </div>
            )}

            {/* 외화 잔고 추이 차트 */}
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">월별 외화 잔고 원화환산 추이 (억원)</div>
              <div className="flex gap-4 mb-2">
                <LegendDot color="#3b82f6" label="외화 잔고 (원화환산)" />
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={fxAnalysis.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="억" />
                    <Tooltip formatter={(v: unknown) => [`${v}억원`, '외화잔고']} />
                    <Line type="monotone" dataKey="krw" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    {effectiveFxDate && (
                      <ReferenceLine
                        x={effectiveFxDate.slice(0, 7)}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        label={{ value: '기준일', position: 'top', fontSize: 10, fill: '#f59e0b' }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 미실행 vs 현재 최대 손실 비교 바 */}
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">
                환전 미실행 vs 현재 — 최대 예상 손실 비교 (억원)
              </div>
              <div className="flex gap-4 mb-2">
                <LegendDot color="#f87171" label="환전 미실행 시" />
                <LegendDot color="#34d399" label="현재" />
              </div>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      {
                        name: `최대 손실 (Z${fxAnalysis.confLevel})`,
                        '미실행 시': Math.round(fxAnalysis.maxLossBase / 1e8 * 10) / 10,
                        현재: Math.round(fxAnalysis.maxLossCurrent / 1e8 * 10) / 10,
                      },
                    ]}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="억" />
                    <Tooltip formatter={(v: unknown) => [`${v}억원`]} />
                    <Bar dataKey="미실행 시" fill="#f87171" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="현재" fill="#34d399" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400 dark:text-slate-500 text-center py-8">
            외화 잔고 이력 데이터가 없습니다.
          </div>
        )}
        </div>}
      </section>

      {/* ── 섹션 2: 국채 Exit 효과 ───────────────────────────────── */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <button
          onClick={() => setBondOpen(o => !o)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-left"
        >
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-slate-100">📈 국채 Exit 효과 분석</h3>
            <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
              국채를 매도하지 않았을 때의 금리 리스크와 현재 절감된 Duration 리스크를 비교합니다.
            </p>
          </div>
          <span className={`text-gray-400 dark:text-slate-400 text-lg transition-transform duration-200 ${bondOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {bondOpen && <div className="px-6 pb-6 space-y-5">
        {/* 기준일 선택 */}
        <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-gray-400 dark:text-slate-400">기준일</span>
            {baseDateBond === null && autoBaseDate.bond ? (
              <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                자동: {autoBaseDate.bond}
              </span>
            ) : null}
            <input
              type="date"
              value={effectiveBondDate ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setBaseDateBond(e.target.value || null)}
              className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            {baseDateBond && (
              <button
                onClick={() => setBaseDateBond(null)}
                className="text-xs text-blue-500 hover:underline"
              >
                자동으로
              </button>
            )}
          </div>

        {bondAnalysis ? (
          <>
            {/* 비교 카드 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CmpCard
                label="현재 보유 국채"
                value={fmtKRW(bondAnalysis.currentValue)}
                sub={`${bondAnalysis.current.length}건`}
              />
              <CmpCard
                label={`기준일 이후 Exit 국채${effectiveBondDate ? ` (${effectiveBondDate} 이후)` : ''}`}
                value={fmtKRW(bondAnalysis.exitedValue)}
                sub={`${bondAnalysis.relevantExited.length}건`}
                highlight="blue"
              />
              <CmpCard
                label="Exit 없었을 경우 (가상)"
                value={fmtKRW(bondAnalysis.hypotheticalValue)}
                sub={`Duration ${bondAnalysis.duration.toFixed(1)}년`}
                highlight="red"
              />
              <CmpCard
                label="+100bp 시 절감 리스크"
                value={bondAnalysis.saving100 > 0
                  ? `▲ ${Math.abs(bondAnalysis.saving100).toFixed(1)}억원`
                  : `▼ ${Math.abs(bondAnalysis.saving100).toFixed(1)}억원`}
                sub="(가상손실 − 현재손실)"
                highlight={bondAnalysis.saving100 > 0 ? 'green' : 'red'}
              />
            </div>

            {/* 절감 배너 */}
            {bondAnalysis.saving100 > 0 && bondAnalysis.exitedValue > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-5 py-3 text-sm text-emerald-800 dark:text-emerald-300">
                ✅ 국채 Exit 실행으로 금리 +1%p 상승 시 손실 위험을 <strong>{Math.abs(bondAnalysis.saving100).toFixed(1)}억원</strong> 줄였습니다.
              </div>
            )}
            {bondAnalysis.exitedValue === 0 && (
              <div className="text-xs text-gray-400 dark:text-slate-500 px-1">
                기준일 이후 Exit된 국채가 없습니다. 기준일을 조정하거나 Exit 이력을 확인하세요.
              </div>
            )}

            {/* Exit 이력 목록 */}
            {bondAnalysis.relevantExited.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">Exit 국채 이력</div>
                <div className="space-y-1">
                  {bondAnalysis.relevantExited.map(b => (
                    <div key={b.id}
                      className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                      <span className="font-mono text-gray-400">{b.end?.slice(0, 10) ?? b.start?.slice(0, 10)}</span>
                      <span className="flex-1 truncate">{b.bond_name ?? b.bank}</span>
                      <span className="font-medium">{fmtKRW(calcBondValue(b.bondQty ?? 0, b.bondPrice ?? 0))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 금리 시나리오 비교 바차트 */}
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-2">
                금리 시나리오별 평가손익 비교 (억원) — Duration {bondAnalysis.duration.toFixed(1)}년
              </div>
              <div className="flex gap-4 mb-2">
                <LegendDot color="#f87171" label="Exit 미실행 시 (가상)" />
                <LegendDot color="#60a5fa" label="현재" />
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bondAnalysis.scenarios} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="억" />
                    <Tooltip formatter={(v: unknown) => [`${v}억원`]} />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Bar dataKey="미실행시" name="미실행 시 (가상)" fill="#f87171" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="현재" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                * ΔP ≈ −Duration × Δy × 평가금액
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400 dark:text-slate-500 text-center py-8">
            국채 이력 데이터가 없습니다.
          </div>
        )}
        </div>}
      </section>

    </div>
  )
}
