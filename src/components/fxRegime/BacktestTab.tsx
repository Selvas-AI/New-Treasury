/**
 * BacktestTab — 프로토콜 백테스트 (Phase 5)
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md
 *
 * 이 탭이 이 기능 전체의 존재 이유다.
 * 판정 화면만 있으면 "이 규칙이 옳은가"를 아무도 검증할 수 없고,
 * 2026-07 매각 시기 논쟁이 근거 없이 반복된다.
 *
 * ⚠ 계산은 fxBacktest.runBacktest() 가 전담하며, 그 안에서 실제 판정 함수
 *   evaluateRegime() 을 그대로 호출한다. 이 컴포넌트에는 판정 로직이 없다.
 */
import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import { runBacktest, type BacktestResult } from '../../lib/fxBacktest'
import { DEFAULT_PROTOCOL, type PolicyProtocol, type RegimeSeriesPoint } from '../../lib/fxRegime'
import { fmtKRW } from '../../lib/format'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

export interface BacktestTabProps {
  series:          RegimeSeriesPoint[]
  protocol:        PolicyProtocol
  initialTotalKRW: number
  initialFxRatio:  number
  fxPayableFx:     number
  policyMinRatio:  number | null
  policyMaxRatio:  number | null
}

interface Preset { label: string; from: string; hint: string }

function buildPresets(series: RegimeSeriesPoint[]): Preset[] {
  if (!series.length) return []
  const last = series[series.length - 1].date
  const y = Number(last.slice(0, 4))
  return [
    { label: '전체 구간',    from: series[Math.min(300, series.length - 1)].date, hint: '워밍업 이후 전 구간' },
    { label: '2022 급등장',  from: '2022-06-01', hint: '고변동 국면 표본' },
    { label: '최근 2년',     from: `${y - 2}-${last.slice(5)}`, hint: '' },
    { label: '2026-07 이후', from: '2026-07-01', hint: '실제 매각 시기 논쟁 구간 리플레이' },
  ]
}

function pct(v: number, d = 2) { return `${(v * 100).toFixed(d)}%` }

export default function BacktestTab(props: BacktestTabProps) {
  const {
    series, protocol, initialTotalKRW, initialFxRatio,
    fxPayableFx, policyMinRatio, policyMaxRatio,
  } = props

  const presets = useMemo(() => buildPresets(series), [series])
  const [from, setFrom]           = useState<string>('')
  const [costBps, setCostBps]     = useState(10)
  const [checkDays, setCheckDays] = useState(5)
  const [ignoreBand, setIgnoreBand] = useState(false)

  const startDate = from || presets[0]?.from || ''

  const common = {
    series, startDate,
    initialTotalKRW, initialFxRatio, fxPayableFx,
    policyMinRatio: ignoreBand ? null : policyMinRatio,
    policyMaxRatio: ignoreBand ? null : policyMaxRatio,
    checkEveryDays: checkDays,
    costBps,
  }

  // 현재 프로토콜 vs 코드 기본 프로토콜 — 두 개를 같은 구간에 돌려 비교한다.
  // 단일 결과만 보면 "좋아 보인다" 외에 판단할 근거가 없다.
  const resultA: BacktestResult = useMemo(
    () => runBacktest({ ...common, protocol }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, startDate, initialTotalKRW, initialFxRatio, fxPayableFx,
     policyMinRatio, policyMaxRatio, protocol, costBps, checkDays, ignoreBand],
  )
  const resultB: BacktestResult = useMemo(
    () => runBacktest({ ...common, protocol: DEFAULT_PROTOCOL }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, startDate, initialTotalKRW, initialFxRatio, fxPayableFx,
     policyMinRatio, policyMaxRatio, costBps, checkDays, ignoreBand],
  )

  const chart = useMemo(() => {
    if (!resultA.points.length) return []
    const bMap = new Map(resultB.points.map(p => [p.date, p.strategy]))
    // 1,100+ 점을 그대로 그리면 렌더가 무거워 4일 간격으로 솎는다(추이 판단에 충분)
    const step = resultA.points.length > 400 ? 4 : 1
    return resultA.points
      .filter((_, i) => i % step === 0 || i === resultA.points.length - 1)
      .map(p => ({
        date: p.date,
        현재프로토콜: Math.round(p.strategy / 1e8 * 10) / 10,
        기본프로토콜: Math.round((bMap.get(p.date) ?? p.strategy) / 1e8 * 10) / 10,
        미실행: Math.round(p.buyHold / 1e8 * 10) / 10,
      }))
  }, [resultA, resultB])

  const noData = !resultA.points.length

  return (
    <div className="space-y-4">
      {/* ⛔ 모델 부적합 경고 — 숫자가 그대로 정책회의로 넘어가는 것을 막는다 */}
      <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-3 text-xs leading-relaxed text-red-800 dark:bg-red-900/20 dark:text-red-300">
        <strong>⛔ 이 시뮬레이션의 손익 수치를 정책 근거로 쓰지 마세요 (모델 재설계 필요)</strong>
        <div className="mt-1">
          이 모델은 <strong>고정된 자금 풀을 목표 비중으로 리밸런싱</strong>한다고 가정해,
          비중이 목표에 미달하면 외화를 <strong>매수</strong>합니다.
          그러나 실측 결과 이 회사는 외화 매매 이력 12건이 <strong>전부 매도</strong>이고 매수는 0건이며,
          매달 약 <strong>3.0M USD가 자동 유입</strong>되는 <strong>순수입(수출) 구조</strong>입니다.
          따라서 아래 거래 내역에는 실제로는 일어나지 않을 매수가 섞여 있습니다.
        </div>
        <div className="mt-1">
          올바른 모델은 &ldquo;유입되는 외화를 <strong>언제 환전할지</strong>&rdquo;를 결정하고,
          벤치마크도 ①즉시 전액 환전 ②전혀 환전 안 함 이어야 합니다.
          현재 화면은 <strong>국면 판정 자체의 동작 확인용</strong>으로만 보세요.
        </div>
      </div>

      {/* 조건 */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">기간</span>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => setFrom(p.from)}
              title={p.hint}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                startDate === p.from
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >{p.label}</button>
          ))}
          <input
            type="date"
            value={startDate}
            onChange={e => setFrom(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-slate-300">
          <label className="flex items-center gap-1">
            점검 주기
            <select
              value={checkDays}
              onChange={e => setCheckDays(Number(e.target.value))}
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value={1}>매일</option>
              <option value={5}>주 1회</option>
              <option value={20}>월 1회</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            거래비용
            <input
              type="number" min={0} max={100} value={costBps}
              onChange={e => setCostBps(Number(e.target.value))}
              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-right dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />bp
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={ignoreBand} onChange={e => setIgnoreBand(e.target.checked)} />
            정책 밴드 무시 (순수 알고리즘 성능)
          </label>
          <span className="text-gray-400 dark:text-slate-500">
            초기 {fmtKRW(initialTotalKRW)} · 외화비중 {pct(initialFxRatio, 1)}
          </span>
        </div>
      </div>

      {noData ? (
        <div className={CARD}>
          <div className="text-sm text-gray-600 dark:text-slate-300">
            선택한 시작일 이전에 워밍업 표본(최소 30영업일)이 부족합니다. 더 이른 날짜를 선택하세요.
          </div>
        </div>
      ) : (
        <>
          {/* 성과 요약 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="전략 기말 자산"
              value={fmtKRW(resultA.finalStrategyKRW)}
              sub={`미실행 대비 ${resultA.excessKRW >= 0 ? '+' : ''}${fmtKRW(resultA.excessKRW)}`}
              tone={resultA.excessKRW >= 0 ? 'good' : 'bad'}
            />
            <Metric
              label="아무것도 안 했을 때"
              value={fmtKRW(resultA.finalBuyHoldKRW)}
              sub="초기 비중 그대로 유지"
            />
            <Metric
              label="거래"
              value={`${resultA.tradeCount}회`}
              sub={`비용 ${fmtKRW(resultA.totalCostKRW)}`}
            />
            <Metric
              label="최대 낙폭 (MDD)"
              value={pct(resultA.maxDrawdown)}
              sub={`미실행 ${pct(resultA.buyHoldMaxDrawdown)}`}
              tone={resultA.maxDrawdown <= resultA.buyHoldMaxDrawdown ? 'good' : 'bad'}
            />
          </div>

          {/* 차트 */}
          <div className={CARD}>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
              총자산 추이 (억원)
            </div>
            <div className="h-72 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={50} />
                  <Tooltip
                    formatter={(v, n) => [`${typeof v === 'number' ? v.toFixed(1) : v}억원`, String(n ?? '')]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={initialTotalKRW / 1e8} stroke="#94a3b8" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="미실행"      stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="기본프로토콜" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  <Line type="monotone" dataKey="현재프로토콜" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
              회색 = 아무 조치도 하지 않은 경우. 파랑이 회색 위에 있어야 이 프로토콜이 가치를 만든 것입니다.
            </div>
          </div>

          {/* 프로토콜 비교 */}
          <div className={CARD}>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">프로토콜 비교</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2">구분</th>
                    <th className="py-2 text-right">기말 자산</th>
                    <th className="py-2 text-right">미실행 대비</th>
                    <th className="py-2 text-right">거래</th>
                    <th className="py-2 text-right">MDD</th>
                    <th className="py-2 text-right">실현 환차손익</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <Row name="현재 프로토콜" r={resultA} strong />
                  <Row name="코드 기본값"   r={resultB} />
                  <tr className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5 text-gray-600 dark:text-slate-300">아무것도 안 함</td>
                    <td className="py-1.5 text-right">{fmtKRW(resultA.finalBuyHoldKRW)}</td>
                    <td className="py-1.5 text-right text-gray-400">—</td>
                    <td className="py-1.5 text-right">0회</td>
                    <td className="py-1.5 text-right">{pct(resultA.buyHoldMaxDrawdown)}</td>
                    <td className="py-1.5 text-right text-gray-400">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {resultA.skippedChecks > 0 && (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                표본 부족으로 건너뛴 점검 {resultA.skippedChecks}회 (변동성 Z-Score 는 약 272영업일이 쌓여야 산출됩니다)
              </div>
            )}
          </div>

          {/* 거래 로그 */}
          <div className={CARD}>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
              거래 내역 (현재 프로토콜 · 최근 30건)
            </div>
            {resultA.trades.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400">
                이 구간에서는 거래가 발생하지 않았습니다 — 목표와 현재 비중의 차이가 리밸런싱 밴드 이내였습니다.
              </div>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-1.5">일자</th>
                      <th className="py-1.5">국면</th>
                      <th className="py-1.5 text-right">환율</th>
                      <th className="py-1.5 text-right">수량(외화)</th>
                      <th className="py-1.5 text-right">비중 변화</th>
                      <th className="py-1.5 text-right">실현손익</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {resultA.trades.slice(-30).reverse().map((t, i) => (
                      <tr key={`${t.date}-${i}`} className="border-b border-gray-100 dark:border-slate-800">
                        <td className="py-1">{t.date}</td>
                        <td className="py-1">{t.regime}</td>
                        <td className="py-1 text-right">{t.rate.toFixed(1)}</td>
                        <td className={`py-1 text-right ${t.amountFx < 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                          {t.amountFx < 0 ? '' : '+'}{Math.round(t.amountFx).toLocaleString()}
                        </td>
                        <td className="py-1 text-right text-gray-500 dark:text-slate-400">
                          {pct(t.beforeRatio, 1)} → {pct(t.targetRatio, 1)}
                        </td>
                        <td className={`py-1 text-right ${t.realizedPnlKRW >= 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {t.realizedPnlKRW === 0 ? '—' : fmtKRW(t.realizedPnlKRW)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            <strong>해석 시 주의</strong> — 이 시뮬레이션은 이자(원화·외화 예금금리)를 반영하지 않고,
            매매 외 자금 유입·유출이 없다고 가정합니다. 실현 환차손익은 가중평균법 기준입니다(FIFO 아님).
            따라서 절대 금액보다 <strong>&ldquo;아무것도 안 함&rdquo; 대비 상대 성과</strong>로 읽어야 합니다.
          </div>
        </>
      )}
    </div>
  )
}

// ── 모듈 레벨 헬퍼 (렌더 중 컴포넌트 정의 금지 — 입력 포커스 유실 전례) ──

function Metric({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad'
}) {
  const toneCls = tone === 'good'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-slate-100'
  return (
    <div className={CARD}>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

function Row({ name, r, strong }: { name: string; r: BacktestResult; strong?: boolean }) {
  return (
    <tr className="border-b border-gray-100 dark:border-slate-800">
      <td className={`py-1.5 ${strong ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}`}>{name}</td>
      <td className="py-1.5 text-right">{fmtKRW(r.finalStrategyKRW)}</td>
      <td className={`py-1.5 text-right ${r.excessKRW >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
        {r.excessKRW >= 0 ? '+' : ''}{fmtKRW(r.excessKRW)}
      </td>
      <td className="py-1.5 text-right">{r.tradeCount}회</td>
      <td className="py-1.5 text-right">{pct(r.maxDrawdown)}</td>
      <td className="py-1.5 text-right">{r.realizedPnlKRW === 0 ? '—' : fmtKRW(r.realizedPnlKRW)}</td>
    </tr>
  )
}
