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
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import InfoTip from '../common/InfoTip'
import { runBacktest, type BacktestResult } from '../../lib/fxBacktest'
import { type PolicyProtocol, type RegimeSeriesPoint } from '../../lib/fxRegime'
import { fmtKRW } from '../../lib/format'
import type { FxTradeRecord } from '../../types'
import {
  runProjection, historicalAnnualVolPct,
  type FxProjectionInput, type FxProjectionScenario, type MonteCarloResult,
} from '../../lib/fxProjection'
import type { FxLot } from '../../lib/fxLots'
import type { MonteCarloWorkerMessage, MonteCarloWorkerRequest } from '../../lib/fxMonteCarlo.worker'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

export interface BacktestTabProps {
  series:          RegimeSeriesPoint[]
  protocol:        PolicyProtocol
  initialTotalKRW: number
  initialFxHolding: number
  monthlyInflowFx: number
  fxPayableFx:     number
  policyMinRatio:  number | null
  policyMaxRatio:  number | null
  /** 평균 취득환율 (0=미설정) — 실현손익 이익/손실 분리 집계용 */
  avgAcquisitionRate: number
  /** 최대 미환전 노출 한도 (0=미설정) */
  maxExposureKRW:  number
  actualTrades?: FxTradeRecord[]
  initialLots?: FxLot[]
  currency: string
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
function fmtRate(v: number | null) { return v == null ? '—' : `${v.toFixed(1)}원` }

export default function BacktestTab({
  series, protocol, initialTotalKRW, initialFxHolding, monthlyInflowFx,
  fxPayableFx, policyMinRatio, policyMaxRatio,
  avgAcquisitionRate, maxExposureKRW,
  actualTrades = [], initialLots = [], currency,
}: BacktestTabProps) {

  const presets = useMemo(() => buildPresets(series), [series])
  const [from, setFrom]           = useState<string>('')
  const [costBps, setCostBps]     = useState(10)
  const [checkDays, setCheckDays] = useState(5)
  const [ignoreBand, setIgnoreBand] = useState(false)
  const [projectionMonths, setProjectionMonths] = useState(12)
  const [projectionScenario, setProjectionScenario] = useState<FxProjectionScenario>('flat')
  const [annualMovePct, setAnnualMovePct] = useState(8)
  const [randomize, setRandomize] = useState(false)
  const [volTouched, setVolTouched] = useState(false)
  const [volatilityInput, setVolatilityInput] = useState(8)
  const [rerollSeed, setRerollSeed] = useState(0)
  const [mcRuns, setMcRuns] = useState(15)
  const [mcProgress, setMcProgress] = useState(0)
  const [mc, setMc] = useState<MonteCarloResult | null>(null)
  const [mcLoading, setMcLoading] = useState(false)
  const mcWorkerRef = useRef<Worker | null>(null)

  // 사용자가 직접 값을 건드리기 전까지는 최근 1년 실측 변동성을 기본값으로 따라간다
  const historicalVol = useMemo(() => Math.round(historicalAnnualVolPct(series) * 10) / 10, [series])
  const volatilityPct = volTouched ? volatilityInput : historicalVol

  const startDate = from || presets[0]?.from || ''

  const common = {
    series, startDate, initialTotalKRW, initialFxHolding, monthlyInflowFx, fxPayableFx,
    policyMinRatio: ignoreBand ? null : policyMinRatio,
    policyMaxRatio: ignoreBand ? null : policyMaxRatio,
    checkEveryDays: checkDays,
    costBps,
  }

  const result: BacktestResult = useMemo(
    () => runBacktest({ ...common, protocol, avgAcquisitionRate, maxExposureKRW }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, startDate, initialTotalKRW, initialFxHolding, monthlyInflowFx, fxPayableFx,
     policyMinRatio, policyMaxRatio, protocol, costBps, checkDays, ignoreBand,
     avgAcquisitionRate, maxExposureKRW],
  )

  const chart = useMemo(() => {
    if (!result.points.length) return []
    const step = result.points.length > 400 ? 4 : 1
    return result.points
      .filter((_, i) => i % step === 0 || i === result.points.length - 1)
      .map(p => ({
        date: p.date,
        전략보유: Math.round(p.strategyHoldingFx),
        미환전누적: Math.round(p.neverHoldingFx),
      }))
  }, [result])

  const fifoChart = useMemo(() => {
    if (!result.points.length || avgAcquisitionRate <= 0) return []
    const step = result.points.length > 400 ? 4 : 1
    return result.points
      .filter((_, i) => i % step === 0 || i === result.points.length - 1)
      .map(p => ({
        date: p.date,
        시장환율: Math.round(p.rate * 10) / 10,
        FIFO장부환율: p.fifoBookRate == null ? null : Math.round(p.fifoBookRate * 10) / 10,
        누적실현손익: p.fifoCumulativeRealizedPnlKRW == null ? null : Math.round(p.fifoCumulativeRealizedPnlKRW),
        남은평가손익: p.fifoUnrealizedPnlKRW == null ? null : Math.round(p.fifoUnrealizedPnlKRW),
        총손익: p.fifoTotalPnlKRW == null ? null : Math.round(p.fifoTotalPnlKRW),
      }))
  }, [result, avgAcquisitionRate])

  const noData = !result.points.length
  const actual = useMemo(() => {
    const rows = actualTrades.filter(row => row.status === '완료' && row.direction === 'sell' &&
      row.currency === currency && row.trade_date >= startDate &&
      (row.completed_rate ?? row.trade_rate) != null)
    const amount = rows.reduce((sum, row) => sum + row.amount_fx, 0)
    const proceeds = rows.reduce((sum, row) => sum + row.amount_fx * (row.completed_rate ?? row.trade_rate ?? 0), 0)
    const pnl = rows.reduce((sum, row) => sum + (row.completed_pnl ?? row.fx_pnl ?? 0), 0)
    return { rows, amount, weightedRate: amount > 0 ? proceeds / amount : null, pnl }
  }, [actualTrades, startDate, currency])

  const projection = useMemo(() => runProjection({
    history: series, months: projectionMonths, scenario: projectionScenario, annualMovePct,
    initialTotalKRW, initialFxHolding, monthlyInflowFx, fxPayableFx,
    policyMinRatio: ignoreBand ? null : policyMinRatio,
    policyMaxRatio: ignoreBand ? null : policyMaxRatio,
    protocol, checkEveryDays: checkDays, costBps, avgAcquisitionRate, initialLots, maxExposureKRW,
    randomize, volatilityPct,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rerollSeed 는 참조하지 않지만 "다시 뽑기" 클릭 시 재계산을 강제하기 위한 트리거
  }), [series, projectionMonths, projectionScenario, annualMovePct, initialTotalKRW,
    initialFxHolding, monthlyInflowFx, fxPayableFx, ignoreBand, policyMinRatio,
    policyMaxRatio, protocol, checkDays, costBps, avgAcquisitionRate, initialLots, maxExposureKRW,
    randomize, volatilityPct, rerollSeed])

  const projectionChart = useMemo(() => projection.result.points.map(p => ({
    date: p.date,
    시장환율: Math.round(p.rate * 10) / 10,
    FIFO장부환율: p.fifoBookRate == null ? null : Math.round(p.fifoBookRate * 10) / 10,
    총손익: p.fifoTotalPnlKRW == null ? null : Math.round(p.fifoTotalPnlKRW),
  })), [projection])

  function stopMcWorker() {
    mcWorkerRef.current?.terminate()
    mcWorkerRef.current = null
  }

  // 기저 가정이 바뀌면 이전에 돌려둔 무작위 반복 결과는 더 이상 유효하지 않다 — 진행 중이면 중단한다
  useEffect(() => {
    stopMcWorker()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 여러 입력값 변경 시 파생 상태(mc)를 무효화하는 의도적 리셋
    setMc(null)
    setMcLoading(false)
  }, [series, projectionMonths, projectionScenario, annualMovePct,
    initialTotalKRW, initialFxHolding, monthlyInflowFx, fxPayableFx, ignoreBand, policyMinRatio,
    policyMaxRatio, protocol, checkDays, costBps, avgAcquisitionRate, initialLots, maxExposureKRW, volatilityPct])

  // 탭을 떠날 때도 실행 중인 워커가 계속 백그라운드에서 도는 일이 없도록 정리한다
  useEffect(() => stopMcWorker, [])

  /**
   * 백테스트 1회조차 가볍지 않다(매 점검일마다 전체 이력을 다시 계산). 이전에는
   * 메인 스레드에서 setTimeout(0) 으로 한 틱씩 양보하며 N회를 실행했지만,
   * 실행 1회 자체가 이미 눈에 띄게 느려 반복 횟수와 무관하게 화면이 멈춘 것처럼
   * 보였다(2026-08-13 사용자 리포트, 재발). 계산 전체를 워커로 완전히 옮겨
   * 메인 스레드를 아예 건드리지 않는다 — 아무리 오래 걸려도 화면은 멈추지 않는다.
   */
  function runMonteCarlo() {
    stopMcWorker()
    setMcLoading(true)
    setMcProgress(0)

    const worker = new Worker(new URL('../../lib/fxMonteCarlo.worker.ts', import.meta.url), { type: 'module' })
    mcWorkerRef.current = worker

    const input: FxProjectionInput = {
      history: series, months: projectionMonths, scenario: projectionScenario, annualMovePct,
      initialTotalKRW, initialFxHolding, monthlyInflowFx, fxPayableFx,
      policyMinRatio: ignoreBand ? null : policyMinRatio,
      policyMaxRatio: ignoreBand ? null : policyMaxRatio,
      protocol, checkEveryDays: checkDays, costBps, avgAcquisitionRate, initialLots, maxExposureKRW,
      volatilityPct,
    }

    worker.onmessage = (e: MessageEvent<MonteCarloWorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') setMcProgress(msg.done)
      else {
        setMc(msg.result)
        setMcLoading(false)
        stopMcWorker()
      }
    }
    worker.onerror = () => {
      setMcLoading(false)
      stopMcWorker()
    }
    const req: MonteCarloWorkerRequest = { type: 'run', input, runs: mcRuns }
    worker.postMessage(req)
  }

  function cancelMonteCarlo() {
    stopMcWorker()
    setMcLoading(false)
  }

  return (
    <div className="space-y-4">
      {/* ⭐ 해석 프레임 — 이 탭을 과거 실적으로 오독하는 것을 막는다 */}
      <div className="rounded-lg border-l-4 border-blue-600 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
        <div className="text-[13px] font-bold">
          이 탭은 <u>과거 실적 재현이 아닙니다</u> — 같은 조건 위에서 두 규칙을 겨루게 한 <u>실험</u>입니다.
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <div className="font-semibold">✔ 진짜인 것</div>
            <div className="mt-0.5 opacity-90">
              환율 시계열(한국은행 실제 고시값)과, 각 시점의 국면 판정.
              판정에는 그날까지의 자료만 씁니다(미래를 보지 않음).
            </div>
          </div>
          <div>
            <div className="font-semibold">✎ 가정인 것</div>
            <div className="mt-0.5 opacity-90">
              <strong>시작 시점의 보유액·자금 규모·월 유입액은 &lsquo;오늘 입력값&rsquo;을 그대로 과거에 놓은 것</strong>입니다.
              그 시점 회사의 실제 잔고가 아닙니다.
            </div>
          </div>
          <div>
            <div className="font-semibold">👁 읽는 법</div>
            <div className="mt-0.5 opacity-90">
              <strong>금액(환전량·실현액)은 참고치</strong>입니다.
              의미가 있는 것은 <strong>실현환율이 기간 평균보다 높은가</strong>와
              <strong> 두 규칙의 차이</strong>뿐입니다.
            </div>
          </div>
        </div>
        <div className="mt-2 border-t border-blue-200 pt-2 dark:border-blue-800">
          비유하자면 <strong>같은 도로를 두 운전자에게 달리게 해 본 것</strong>입니다.
          도로(환율)는 실제이지만 차에 실은 짐(잔고)은 오늘 기준으로 통일했습니다.
          그래야 <strong>운전 방식의 차이만</strong> 남기 때문입니다.
          &ldquo;그때 우리가 얼마를 벌었을 것이다&rdquo;로 읽으면 안 됩니다.
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
        </div>

        {/* 가정 조건 — 흐리게 두면 못 보고 지나쳐 실적으로 오해한다 */}
        <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <strong>가정 조건</strong> — {startDate} 시점에{' '}
          외화 <strong>{Math.round(initialFxHolding).toLocaleString()}</strong> 보유,
          자금 총액 <strong>{fmtKRW(initialTotalKRW)}</strong>,
          월 유입 <strong>{Math.round(monthlyInflowFx).toLocaleString()}</strong> 로 시작했다고 두었습니다.
          <span className="ml-1 text-amber-700 dark:text-amber-400">
            세 값 모두 <strong>오늘 입력값</strong>이며 그 시점의 실제 잔고가 아닙니다.
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
          {avgAcquisitionRate > 0 && (
            <>
              <SectionDivider label="▶ FX REGIME 알고리즘 적용 후 시뮬레이션" />
              <div className={CARD}>
                <div className="mb-1 text-sm font-bold text-gray-800 dark:text-slate-100">환율 추이에 따른 장부환율 정상화 예측 시뮬레이션</div>
              <div className="mb-3 text-[11px] text-gray-500 dark:text-slate-400">
                예측값이 아니라 선택한 환율 경로가 계속된다고 가정한 실험입니다. 국면 판정은 미래 시점마다 그날까지 만들어진 값만 사용합니다.
              </div>
              <div className="mb-3 flex flex-wrap items-end gap-3 text-xs">
                <label className="flex flex-col gap-1">기간
                  <select value={projectionMonths} onChange={e => setProjectionMonths(Number(e.target.value))}
                    className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800">
                    <option value={6}>6개월</option><option value={12}>12개월</option><option value={24}>24개월</option><option value={36}>36개월</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">환율 가정
                  <select value={projectionScenario} onChange={e => setProjectionScenario(e.target.value as FxProjectionScenario)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800">
                    <option value="flat">현재 수준 유지</option><option value="up">완만한 상승</option>
                    <option value="down">완만한 하락</option><option value="replay">최근 1년 등락 반복</option>
                  </select>
                </label>
                {(projectionScenario === 'up' || projectionScenario === 'down') && (
                  <label className="flex flex-col gap-1">연간 이동폭
                    <span><input type="number" min={1} max={30} value={annualMovePct} onChange={e => setAnnualMovePct(Number(e.target.value))}
                      className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-800" />%</span>
                  </label>
                )}
                <label className="flex items-center gap-1.5 pb-1.5">
                  <input type="checkbox" checked={randomize}
                    onChange={e => { setRandomize(e.target.checked); setMc(null) }} />
                  변동성 반영(무작위 흔들림)
                  <InfoTip text={[
                    '위 추세(현재 수준 유지·상승·하락 등)는 매끄러운 직선으로 그려집니다. 실제 환율은 그 추세 위에서 매일 흔들립니다.',
                    '이 옵션을 켜면 최근 1년 실제 변동성만큼 매일 무작위로 흔들리는 경로를 만들어, "이 추세가 맞아도 결과가 이 정도는 갈릴 수 있다"를 보여줍니다.',
                    '"다시 뽑기"는 그 무작위 경로 하나를 새로 뽑고, "N회 반복"은 여러 번 뽑아 결과 범위(밴드)를 보여줍니다.',
                  ]} />
                </label>
                {randomize && (
                  <>
                    <label className="flex flex-col gap-1">변동성(연환산)
                      <span><input type="number" min={1} max={40} step={0.5} value={volatilityPct}
                        onChange={e => { setVolTouched(true); setVolatilityInput(Number(e.target.value)); setMc(null) }}
                        className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-800" />%</span>
                      <span className="text-[10px] font-normal text-gray-400 dark:text-slate-500">최근 1년 실측 {historicalVol}%</span>
                    </label>
                    <button
                      onClick={() => { setRerollSeed(s => s + 1); setMc(null) }}
                      disabled={mcLoading}
                      className="rounded border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >🎲 다시 뽑기</button>
                    <label className="flex flex-col gap-1">반복 횟수
                      <select value={mcRuns} onChange={e => { setMcRuns(Number(e.target.value)); setMc(null) }}
                        disabled={mcLoading}
                        className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800 disabled:opacity-50">
                        <option value={10}>10회(빠름)</option>
                        <option value={15}>15회</option>
                        <option value={30}>30회(느림)</option>
                      </select>
                    </label>
                    {mcLoading ? (
                      <button
                        onClick={cancelMonteCarlo}
                        className="rounded border border-red-300 bg-red-50 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
                      >⏹ 계산 중… ({mcProgress}/{mcRuns}) 취소</button>
                    ) : (
                      <button
                        onClick={runMonteCarlo}
                        className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                      >📊 {mcRuns}회 반복해 범위 보기</button>
                    )}
                  </>
                )}
              </div>

              {/* "환율 가정"과 "변동성 반영"이 서로 다른 축(추세 vs 그 위의 흔들림)이라
                  둘 다 켜져 있으면 무엇으로 그려졌는지 헷갈린다는 피드백(2026-08-13) — 항상 명시한다 */}
              <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                📈 현재 그래프: <strong>
                  {projectionScenario === 'flat' && '현재 수준 유지'}
                  {projectionScenario === 'up' && `완만한 상승(연 ${annualMovePct}%)`}
                  {projectionScenario === 'down' && `완만한 하락(연 ${annualMovePct}%)`}
                  {projectionScenario === 'replay' && '최근 1년 등락 반복'}
                </strong> 추세{randomize
                  ? <> 위에 <strong>무작위 흔들림(변동성 {volatilityPct}%)</strong>을 더한 경로입니다. 위 &lsquo;환율 가정&rsquo;은 흔들림의 기준 추세로 계속 쓰이니, 바꾸면 무작위 경로도 함께 바뀝니다.</>
                  : <> 그대로 매끄러운 직선입니다. 실제처럼 흔들리는 경로를 보려면 &lsquo;변동성 반영&rsquo;을 켜세요.</>}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Metric label="고원가 개시 재고 소진" value={projection.openingLotClearedDate ?? '기간 내 미소진'} muted={!projection.openingLotClearedDate} />
                <Metric label="장부환율 정상화(시장가 ±1%)" value={projection.bookRateNormalizedDate ?? '기간 내 미도달'} muted={!projection.bookRateNormalizedDate} />
                <Metric label="총손익 0 이상" value={projection.totalPnlBreakEvenDate ?? '기간 내 미도달'}
                  tone={projection.totalPnlBreakEvenDate ? 'good' : 'bad'} />
              </div>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={projectionChart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                    <YAxis yAxisId="rate" domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={55} tickFormatter={v => Number(v).toLocaleString()} />
                    <YAxis yAxisId="pnl" orientation="right" tick={{ fontSize: 10 }} width={55} tickFormatter={v => `${Math.round(Number(v) / 100_000_000)}억`} />
                    <Tooltip formatter={(v, n) => [n === '총손익' ? fmtKRW(Number(v)) : `${Number(v).toLocaleString()}원`, String(n ?? '')]} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="rate" type="monotone" dataKey="시장환율" stroke="#64748b" strokeWidth={1.5} dot={false} />
                    <Line yAxisId="rate" type="stepAfter" dataKey="FIFO장부환율" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="pnl" type="monotone" dataKey="총손익" stroke="#059669" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {mc && (
                <div className="mt-4 border-t border-gray-100 pt-3 dark:border-slate-700">
                  <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    같은 가정으로 {mc.runs}회 무작위 반복 — 총손익이 어디까지 갈렸는가
                  </div>
                  <div className="mb-3 grid gap-2 sm:grid-cols-2">
                    <Metric
                      label="장부환율 정상화 도달"
                      value={`${mc.normalizedCount}/${mc.runs}회`}
                      sub={mc.avgNormalizedMonths != null ? `도달한 경로 평균 ${mc.avgNormalizedMonths.toFixed(1)}개월` : '기간 내 도달한 경로 없음'}
                    />
                    <Metric
                      label="총손익 흑자 전환 도달"
                      value={`${mc.breakEvenCount}/${mc.runs}회`}
                      sub={mc.avgBreakEvenMonths != null ? `도달한 경로 평균 ${mc.avgBreakEvenMonths.toFixed(1)}개월` : '기간 내 도달한 경로 없음'}
                      tone={mc.breakEvenCount >= mc.runs / 2 ? 'good' : 'bad'}
                    />
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={mc.band.map(b => ({ date: b.date, 상위10: b.pnlP90, 중앙값: b.pnlP50, 하위10: b.pnlP10 }))}
                        margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                        <YAxis tick={{ fontSize: 10 }} width={60} tickFormatter={v => `${Math.round(Number(v) / 100_000_000)}억`} />
                        <Tooltip formatter={(v, n) => [fmtKRW(Number(v)), String(n ?? '')]} contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="상위10" stroke="#059669" strokeDasharray="4 3" strokeWidth={1.25} dot={false} connectNulls />
                        <Line type="monotone" dataKey="중앙값" stroke="#2563eb" strokeWidth={2.25} dot={false} connectNulls />
                        <Line type="monotone" dataKey="하위10" stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1.25} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                    같은 가정(추세·기간)에서 일별 흔들림만 무작위로 {mc.runs}번 다시 뽑아 실행한 결과입니다.
                    파란 선은 {mc.runs}개 경로의 중앙값, 초록·빨강 점선은 각각 상위 10%·하위 10% 지점입니다.
                    이 폭이 넓을수록 같은 가정이라도 실제로 어떻게 흔들리느냐에 따라 결과가 크게 갈릴 수 있다는 뜻입니다.
                    확률이나 예측이 아니라 변동폭을 체감하기 위한 실험입니다.
                  </div>
                </div>
              )}
              </div>
            </>
          )}
          {/* 성과 요약 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              tip={[
                '이 기간에 환전한 외화 전체를 평균 몇 원에 팔았는지입니다. 이 시스템의 핵심 성과지표입니다.',
                '아래 "기간 평균"보다 높아야 의미가 있습니다 — 아무 생각 없이 매일 조금씩 팔았을 때의 평균이 곧 기간 평균이기 때문입니다.',
                '⭐ 자금팀의 실제 KPI는 포트폴리오 수익률이 아니라 "같은 1달러를 얼마나 비싸게 팔았나"입니다.',
              ]}
              label="가중평균 실현환율"
              value={fmtRate(result.weightedAverageRate)}
              sub={`기간 평균 ${fmtRate(result.periodAverageRate)}`}
              tone={(result.ratePremium ?? 0) >= 0 ? 'good' : 'bad'}
            />
            <Metric
              label="평균 대비 실현 프리미엄"
              value={result.ratePremium == null ? '—' : `${result.ratePremium >= 0 ? '+' : ''}${result.ratePremium.toFixed(1)}원`}
              sub={result.ratePremiumPct == null ? '환전 없음' : pct(result.ratePremiumPct)}
              tone={(result.ratePremium ?? 0) >= 0 ? 'good' : 'bad'}
            />
            <Metric
              label="총 환전 실현액 (가정 기준)"
              value={fmtKRW(result.totalRealizedKRW)}
              sub={`${Math.round(result.convertedFx).toLocaleString()} 환전 · ${result.tradeCount}회`}
              muted
              tip={[
                '⚠ 이 금액은 실적이 아닙니다. 시작 잔고를 오늘 입력값으로 가정했을 때 나오는 값입니다.',
                '금액의 크기 자체보다, 같은 가정에서 다른 규칙과 비교했을 때의 차이를 보세요.',
              ]}
            />
            <Metric
              label="최대 미환전 노출 (가정 기준)"
              value={fmtKRW(result.maxExposureKRW)}
              sub={`${Math.round(result.maxExposureFx).toLocaleString()} 외화`}
              muted
              tip={[
                '⚠ 이 금액도 가정 기준입니다.',
                '다만 규칙끼리 비교할 때는 유효합니다 — 어느 규칙이 외화를 더 오래 들고 있는지를 보여줍니다.',
              ]}
            />
          </div>

          {/* 차트 */}
          <div className={CARD}>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
              미환전 외화 잔량 추이
            </div>
            <div className="h-72 md:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} width={65} tickFormatter={v => `${Math.round(Number(v) / 10_000).toLocaleString()}만 ${currency}`} />
                  <Tooltip
                    formatter={(v, n) => [typeof v === 'number' ? `${Math.round(v).toLocaleString()} ${currency}` : v, String(n ?? '')]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="미환전누적" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="전략보유" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
              회색 = 전혀 환전하지 않고 누적, 파랑 = FX 리짐 전략에 따라 환전한 뒤 보유 잔량.
            </div>
          </div>

          {avgAcquisitionRate > 0 && fifoChart.length > 0 && (
            <>
              <SectionDivider label="▶ 예전부터 FX REGIME 알고리즘을 도입했었다면?" />
              <div className={CARD}>
              <div className="mb-1 text-sm font-semibold text-gray-800 dark:text-slate-100">
                동일 외화 유입 가정에서 FX 리짐 전략을 적용한 누적 손익
              </div>
              <div className="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                현재 입력한 시작 재고와 월 유입액이 과거부터 동일하게 들어왔다고 가정하고, 각 날짜의 실제 환율에 FX 리짐 전략을 적용한 실험입니다.
                유입분은 그날 환율로 새 FIFO 로트가 되고, 환전 시 가장 오래된 로트부터 소진됩니다.
                아래 파란 총손익이 0보다 위면 이 가정에서 누적 이익, 아래면 누적 손실입니다. <strong>실제 과거 실적이나 미래 수익 보장은 아닙니다.</strong>
              </div>

              <div className="mb-1 text-xs font-medium text-gray-700 dark:text-slate-200">① 전략 실행 후 남은 FIFO 장부환율은 시장환율에 어떻게 가까워졌나</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={fifoChart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={56} tickFormatter={v => Number(v).toLocaleString()} />
                    <Tooltip formatter={(v, n) => [`${Number(v).toLocaleString()}원`, String(n ?? '')]} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="시장환율" stroke="#64748b" strokeWidth={1.5} dot={false} />
                    <Line type="stepAfter" dataKey="FIFO장부환율" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mb-1 mt-4 text-xs font-medium text-gray-700 dark:text-slate-200">② 동일 유입 가정의 누적 환차손익 — 실현손익 + 남은 재고 평가손익</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={fifoChart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                    <YAxis tick={{ fontSize: 10 }} width={72} tickFormatter={v => `${Math.round(Number(v) / 100_000_000)}억`} />
                    <Tooltip formatter={(v, n) => [fmtKRW(Number(v)), String(n ?? '')]} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="누적실현손익" stroke="#dc2626" strokeWidth={1.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="남은평가손익" stroke="#d97706" strokeWidth={1.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="총손익" stroke="#2563eb" strokeWidth={2.5} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                빨강은 환전으로 확정된 누적 실현손익, 주황은 아직 남은 외화의 평가손익, 파랑은 두 값을 합친 누적 총손익입니다.
                실현손익과 평가손익 사이의 이동만으로 이익이 생긴 것은 아니며, 파란 총손익이 0보다 높아질 때 이 가정에서 경제적 이익이 발생한 것입니다.
                기말 FIFO 장부환율 <strong>{fmtRate(result.endingFifoBookRate)}</strong>, 총손익 <strong>{fmtKRW(result.endingTotalPnlKRW ?? 0)}</strong>.
              </div>
              </div>
            </>
          )}

          {/* 프로토콜 비교 */}
          <div className={CARD}>
            <div className="mb-1 text-sm font-semibold text-gray-800 dark:text-slate-100">
              전략·벤치마크 비교
              <InfoTip text={[
                '"만약 그렇게 팔았다면 평균 얼마에 팔렸을까"를 네 가지 방식으로 겨루게 한 표입니다. 시작 재고·유입액 가정은 네 방식 모두 동일합니다.',
                '"FX 리짐 전략(가정 실험)" 행이 바로 아래 "거래 내역" 표에 나온 그 거래들의 합계입니다 — 국면(하락/중립/상승 등)에 따라 "현재→목표 비중"만큼만 환전한 기록이고, 이 행은 그 거래들을 평균 실현환율로 요약한 것입니다.',
                '① 유입 즉시 전액 환전은 국면을 보지 않고 돈이 들어오는 즉시 파는 비교군, ② 전혀 환전 안 함은 계속 외화로만 쌓아두고 한 번도 안 파는 비교군입니다 — 둘 다 "아무 판단 없이 기계적으로 했을 때"의 대조군입니다.',
                '"FX 리짐 전략" 행의 평균 실현환율이 ①②보다 높으면, 국면별로 타이밍을 나눠 판 것이 무작정 즉시 팔거나 계속 안 파는 것보다 더 비싸게 팔았다는 뜻입니다.',
                '"회사 실제 매각" 행만 실제로 집행된 기록이고 나머지 세 행은 모두 같은 가정 위의 실험입니다. 시작 재고·유입 가정이 실제 회사와 다르므로 평균 실현환율(원/달러 수준)만 비교하고 금액 크기는 직접 비교하지 않습니다.',
              ]} />
            </div>
            <div className="mb-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
              같은 가정(시작 재고·유입액)에서 &ldquo;언제 팔았는가&rdquo;만 다르게 했을 때 평균 실현환율이 어떻게 달라지는지 비교합니다.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2">비교 대상</th>
                    <th className="py-2 text-right">환전 실현액</th>
                    <th className="py-2 text-right">평균 실현환율</th>
                    <th className="py-2 text-right">기말 미환전</th>
                    <th className="py-2 text-right">기말 평가액</th>
                    <th className="py-2 text-right">거래</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {actual.weightedRate != null && <tr className="border-b border-gray-100 bg-emerald-50/60 dark:border-slate-800 dark:bg-emerald-900/10">
                    <td className="py-1.5">
                      <div className="font-semibold text-gray-900 dark:text-slate-100">회사 실제 매각</div>
                      <div className="text-[10px] font-normal text-gray-500 dark:text-slate-400">실제 집행 기록 (가정 아님)</div>
                    </td>
                    <td className="py-1.5 text-right">{fmtKRW(actual.amount * actual.weightedRate)}</td>
                    <td className="py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">{fmtRate(actual.weightedRate)}</td>
                    <td className="py-1.5 text-right text-gray-400">—</td><td className="py-1.5 text-right text-gray-400">—</td>
                    <td className="py-1.5 text-right">{actual.rows.length}회</td>
                  </tr>}
                  <Row name="FX 리짐 전략" caption="같은 가정에서 국면별 타이밍대로 팔았다면" r={result} strong />
                  <tr className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5">
                      <div className="text-gray-600 dark:text-slate-300">① 유입 즉시 전액 환전</div>
                      <div className="text-[10px] font-normal text-gray-400 dark:text-slate-500">대조군 — 국면 안 보고 들어오자마자 바로 매도</div>
                    </td>
                    <td className="py-1.5 text-right">{fmtKRW(result.immediateRealizedKRW)}</td>
                    <td className="py-1.5 text-right">{fmtRate(result.immediateWeightedAverageRate)}</td>
                    <td className="py-1.5 text-right">{Math.round(Math.min(result.totalAvailableFx, fxPayableFx)).toLocaleString()}</td>
                    <td className="py-1.5 text-right text-gray-400">—</td>
                    <td className="py-1.5 text-right">매 유입일</td>
                  </tr>
                  <tr className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5">
                      <div className="text-gray-600 dark:text-slate-300">② 전혀 환전 안 함</div>
                      <div className="text-[10px] font-normal text-gray-400 dark:text-slate-500">대조군 — 계속 외화로만 보유, 한 번도 안 팜</div>
                    </td>
                    <td className="py-1.5 text-right">0원</td>
                    <td className="py-1.5 text-right text-gray-400">—</td>
                    <td className="py-1.5 text-right">{Math.round(result.neverEndingHoldingFx).toLocaleString()}</td>
                    <td className="py-1.5 text-right">{fmtKRW(result.neverEndingValueKRW)}</td>
                    <td className="py-1.5 text-right">0회</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {actual.weightedRate != null && result.weightedAverageRate != null && <div className="mt-2 text-xs text-gray-600 dark:text-slate-300">
              실제 매각 평균은 FX 리짐 전략 실험보다 <strong>{actual.weightedRate - result.weightedAverageRate >= 0 ? '+' : ''}{(actual.weightedRate - result.weightedAverageRate).toFixed(1)}원</strong>입니다.
              실제 확정손익은 <strong>{fmtKRW(actual.pnl)}</strong>이며 수수료 미포함 자료일 수 있습니다. 금액은 서로 다른 재고·유입 가정이므로 직접 성과액으로 비교하지 않습니다.
            </div>}
            {result.skippedChecks > 0 && (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                표본 부족으로 건너뛴 점검 {result.skippedChecks}회
              </div>
            )}
          </div>

          {/* 거래 로그 */}
          <div className={CARD}>
            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
              거래 내역 (현재 프로토콜 · 최근 30건)
            </div>
            {result.trades.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400">
                이 구간에서는 환전이 발생하지 않았습니다. 외화는 매수하지 않고 계속 누적됩니다.
              </div>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-1.5">일자</th>
                      <th className="py-1.5">국면</th>
                      <th className="py-1.5 text-right">환율</th>
                      <th className="py-1.5 text-right">환전 수량</th>
                      <th className="py-1.5 text-right">현재→목표 비중</th>
                      <th className="py-1.5 text-right">원화 실현액</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {result.trades.slice(-30).reverse().map((t, i) => (
                      <tr key={`${t.date}-${i}`} className="border-b border-gray-100 dark:border-slate-800">
                        <td className="py-1">{t.date}</td>
                        <td className="py-1">{t.regime}</td>
                        <td className="py-1 text-right">{t.rate.toFixed(1)}</td>
                        <td className="py-1 text-right text-blue-600 dark:text-blue-400">{Math.round(t.convertedFx).toLocaleString()}</td>
                        <td className="py-1 text-right text-gray-500 dark:text-slate-400">
                          {pct(t.beforeRatio, 1)} → {pct(t.targetRatio, 1)}
                        </td>
                        <td className="py-1 text-right">{fmtKRW(t.realizedKRW)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 취득원가 대비 실현손익 */}
          {avgAcquisitionRate > 0 && (
            <div className={CARD}>
              <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                FIFO 취득원가 대비 실현손익 (개시 장부환율 {avgAcquisitionRate.toLocaleString()}원)
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="실현 이익" value={fmtKRW(result.realizedGainKRW)} tone="good" />
                <Metric label="실현 손실" value={fmtKRW(result.realizedLossKRW)}
                        sub={`취득원가 이하 매도 ${result.belowCostTrades}회`}
                        tone={result.realizedLossKRW < 0 ? 'bad' : undefined} />
                <Metric label="순 실현손익"
                        value={fmtKRW(result.realizedGainKRW + result.realizedLossKRW)}
                        tone={result.realizedGainKRW + result.realizedLossKRW >= 0 ? 'good' : 'bad'} />
              </div>
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                손실 실현은 <strong>차단하지 않습니다</strong> — 비중 상한 해소 등을 위해 필요할 수 있습니다.
                다만 얼마를 실현하는지 항상 명시합니다. 시작 재고는 단일 개시 로트로 근사하고 이후 유입분부터 FIFO 로트를 추적합니다.
              </div>
            </div>
          )}

          <div className="rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            <strong>해석 기준</strong> — 월 유입액은 20영업일에 균등 유입된다고 가정합니다.
            핵심 KPI는 포트폴리오 수익률이 아니라 <strong>가중평균 실현환율이 기간 평균보다 높은가</strong>입니다.
            이자와 실제 일별 수출대금 편차는 반영하지 않습니다.
          </div>
        </>
      )}
    </div>
  )
}

// ── 모듈 레벨 헬퍼 (렌더 중 컴포넌트 정의 금지 — 입력 포커스 유실 전례) ──

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span className="shrink-0 text-xs font-bold text-blue-700 dark:text-blue-300">{label}</span>
      <span className="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
    </div>
  )
}

function Metric({ label, value, sub, tone, tip, muted }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad'; tip?: string[]
  /** 가정에 의존하는 참고 수치 — 시각적으로 낮춰 실적으로 오독되지 않게 한다 */
  muted?: boolean
}) {
  const toneCls = muted
    ? 'text-gray-500 dark:text-slate-400'
    : tone === 'good'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-slate-100'
  return (
    <div className={CARD}>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
        {label}{tip && <InfoTip text={tip} />}
      </div>
      <div className={`mt-1 text-xl font-bold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

function Row({ name, caption, r, strong }: { name: string; caption?: string; r: BacktestResult; strong?: boolean }) {
  return (
    <tr className="border-b border-gray-100 bg-blue-50/50 dark:border-slate-800 dark:bg-blue-900/10">
      <td className="py-1.5">
        <div className={strong ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}>{name}</div>
        {caption && <div className="text-[10px] font-normal text-gray-500 dark:text-slate-400">{caption}</div>}
      </td>
      <td className="py-1.5 text-right">{fmtKRW(r.totalRealizedKRW)}</td>
      <td className={`py-1.5 text-right ${(r.ratePremium ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
        {fmtRate(r.weightedAverageRate)}
      </td>
      <td className="py-1.5 text-right">{Math.round(r.endingHoldingFx).toLocaleString()}</td>
      <td className="py-1.5 text-right">{fmtKRW(r.endingHoldingValueKRW)}</td>
      <td className="py-1.5 text-right">{r.tradeCount}회</td>
    </tr>
  )
}
