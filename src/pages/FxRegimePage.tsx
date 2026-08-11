/**
 * FxRegimePage — 환율 국면 판정 대시보드
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 3
 *
 * ⚠ 현재 개발 전용(App.tsx 에서 import.meta.env.DEV 게이트).
 *    실데이터 검증 + 정책회의 보고를 마친 뒤 프로덕션에 노출한다.
 *
 * 구성:
 *   ① 데이터 수집 패널 — ECOS 백필 / 최신 보충 (이력이 없으면 자동으로 펼침)
 *   ② 국면 판정 카드   — 현재 국면 · 목표 비율 · 권고 조치
 *   ③ 지표 · 차트      — 원시 종가 + 칼만 평활 + 볼린저 밴드
 *
 * 자금 수치는 usePolicyDashboard 의 SSOT(fxTotalHoldings / totalFundAvail)를 그대로 쓴다.
 * 이 화면만 다른 공식을 쓰면 FX 정책 탭과 숫자가 어긋나 신뢰를 잃는다(세션19차 전례).
 */
import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { useFx } from '../hooks/useFx'
import { usePageCompany } from '../hooks/usePageCompany'
import { usePolicyDashboard } from '../hooks/usePolicyDashboard'
import { usePolicyParams } from '../hooks/usePolicyParams'
import {
  useFxHistory, backfillFxHistory, syncLatestFxHistory,
  type BackfillProgress,
} from '../hooks/useFxHistory'
import {
  evaluateRegime, kalmanSmooth, bollinger, protocolFromParams,
  TREND_LABEL, VOL_LABEL,
  type RegimeSeriesPoint, type TrendCode, type VolCode,
} from '../lib/fxRegime'
import ProtocolTab from '../components/fxRegime/ProtocolTab'
import BacktestTab from '../components/fxRegime/BacktestTab'
import { fmtKRW } from '../lib/format'

type TabKey = 'regime' | 'protocol' | 'backtest'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'regime',   label: '📊 현재 국면' },
  { key: 'protocol', label: '🎯 정책 프로토콜' },
  { key: 'backtest', label: '🧪 시뮬레이션' },
]

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP'] as const

/** 추세 코드별 강조색 — 국내 관행(상승=빨강 / 하락=파랑) */
const TREND_TONE: Record<TrendCode, string> = {
  '1': 'text-red-600 dark:text-red-400',
  '2': 'text-red-500 dark:text-red-300',
  '3': 'text-slate-600 dark:text-slate-300',
  '4': 'text-blue-500 dark:text-blue-300',
  '5': 'text-blue-600 dark:text-blue-400',
}

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}
function num(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : v.toFixed(digits)
}

export default function FxRegimePage() {
  const { canEdit, user } = useAuth()
  const { company } = usePageCompany('/fx-regime')
  const [currency, setCurrency] = useState<string>('USD')
  const [tab, setTab] = useState<TabKey>('regime')

  const hist   = useFxHistory(currency, { autoSync: true })
  const policy = usePolicyDashboard(company)
  const params = usePolicyParams(company)
  const fx     = useFx()

  // ── 수집 상태 ──────────────────────────────────────────────────────
  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [collectErr, setErr]    = useState<string | null>(null)

  const thisYear = new Date().getFullYear()
  const [fromYear, setFromYear] = useState(thisYear - 4)

  async function runBackfill() {
    setBusy(true); setErr(null); setProgress('시작…')
    try {
      const res = await backfillFxHistory(currency, fromYear, thisYear, (p: BackfillProgress) => {
        setProgress(p.error
          ? `${p.year}년 — ${p.error}`
          : `${p.year}년 ${p.fetched}건 수집 (누적 ${p.saved}건)`)
      })
      if (res.failed.length) {
        // 부분 성공 — 실패한 연도만 다시 돌리면 된다(upsert 라 중복 없음)
        setErr(`총 ${res.saved.toLocaleString()}건 저장. 실패한 연도: ` +
          res.failed.map(f => `${f.year}(${f.error.slice(0, 40)})`).join(', ') +
          ' — 버튼을 다시 눌러 재시도하세요.')
        setProgress('')
      } else {
        setProgress(`완료 — 총 ${res.saved.toLocaleString()}건 저장`)
      }
      await hist.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '백필 실패')
    } finally { setBusy(false) }
  }

  async function runSync() {
    setBusy(true); setErr(null); setProgress('최신 구간 확인 중…')
    try {
      const n = await syncLatestFxHistory(currency)
      setProgress(n > 0 ? `${n}건 보충 완료` : '이미 최신입니다')
      if (n > 0) await hist.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '보충 실패')
    } finally { setBusy(false) }
  }

  // ── 결제 버퍼 편집 ─────────────────────────────────────────────────
  const [bufDraft, setBufDraft] = useState<string | null>(null)
  const [bufSaving, setBufSaving] = useState(false)

  async function saveBuffer() {
    const v = Number((bufDraft ?? '').replace(/,/g, ''))
    if (!Number.isFinite(v) || v < 0) { setErr('결제 예정액이 올바르지 않습니다.'); return }
    setBufSaving(true)
    const err = await params.set(
      'fx_payable_buffer_usd', v,
      '향후 3개월 외화 결제 예정액(USD)', user?.code ?? 'unknown',
    )
    setBufSaving(false)
    if (err) setErr(`결제 버퍼 저장 실패: ${err}`)
    else { setErr(null); setBufDraft(null) }
  }

  // ── 국면 판정 ──────────────────────────────────────────────────────
  const series: RegimeSeriesPoint[] = useMemo(
    () => hist.data.map(p => ({ date: p.date, rate: p.rate })),
    [hist.data],
  )

  // 향후 3개월 외화 결제 예정액.
  // ⚠ 원화가 아니라 **USD 원금**으로 저장한다 — 실제 채무는 "250만불"이지 "X원"이 아니라서,
  //   원화로 굳혀두면 환율이 오를수록 버퍼가 과소평가되고, 정작 방어가 필요한 국면에
  //   하한이 낮아지는 역효과가 난다. 표시·계산 시점에 현재 환율로 환산한다.
  // TODO: cashflow_plan_items 의 외화 출금 계획에서 자동 산출 (현재는 정책 파라미터 수동 입력)
  const fxPayableUsd = params.get('fx_payable_buffer_usd') ?? 0
  const fxPayableKRW = fx.toKRW(fxPayableUsd, 'USD')

  const ctx = useMemo(() => ({
    totalFundKRW: policy.totalFundAvail,
    fxHoldingKRW: policy.fxTotalHoldings,
    // ⚠ 0 이면 버퍼 하한이 사라져 알고리즘이 전량 매도를 제안할 수 있다.
    fxPayableKRW,
    policyMaxRatio: params.get('fx_target_max') != null ? params.get('fx_target_max')! / 100 : null,
    policyMinRatio: params.get('fx_target_min') != null ? params.get('fx_target_min')! / 100 : null,
  }), [policy.totalFundAvail, policy.fxTotalHoldings, fxPayableKRW, params])

  // 프로토콜은 policy_params 에서 조립 — 값이 없으면 코드 기본값 (protocolFromParams)
  const protocol = useMemo(
    () => protocolFromParams(k => params.get(k)),
    [params],
  )

  const signal = useMemo(
    () => (series.length >= 30 ? evaluateRegime(series, ctx, protocol, currency) : null),
    [series, ctx, protocol, currency],
  )

  // ── 차트 데이터 (최근 180 영업일) ──────────────────────────────────
  const chart = useMemo(() => {
    if (series.length < 21) return []
    const closes = series.map(p => p.rate)
    const smooth = kalmanSmooth(closes, protocol.kalmanQ, protocol.kalmanR)
    const start = Math.max(20, series.length - 180)
    const out: {
      date: string; close: number; kalman: number
      bbRange: [number, number] | null; mid: number | null
    }[] = []
    for (let i = start; i < series.length; i++) {
      // 볼린저는 원시 종가 기준 (fxRegime.computeIndicators 와 동일 규칙)
      const bb = bollinger(closes.slice(0, i + 1), 20, 2)
      out.push({
        date:   series[i].date,
        close:  closes[i],
        kalman: smooth[i],
        // ⚠ [lower, upper] 범위형 Area 로 그린다.
        //   과거엔 lower 를 투명 스택으로 깔고 그 위에 폭을 쌓았는데, 스택 Area 는
        //   0 부터 그려지므로 Y축 도메인이 0 까지 늘어나 환율 선이 납작해졌다(실측 0~1600).
        bbRange: bb ? [bb.lower, bb.upper] : null,
        mid:     bb?.mid ?? null,
      })
    }
    return out
  }, [series, protocol])

  const hasData = hist.data.length > 0
  const range = hasData ? `${hist.data[0].date} ~ ${hist.data[hist.data.length - 1].date}` : '—'

  return (
    <div className="space-y-4 p-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">환율 국면 판정</h1>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          개발 전용 · 검증 중
        </span>
        <div className="ml-auto flex gap-1">
          {CURRENCIES.map(c => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`rounded px-3 py-1 text-sm font-medium transition ${
                currency === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >{c}</button>
          ))}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* ① 데이터 수집 — 모든 탭의 전제라 항상 노출 */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">📥 환율 이력</div>
          <div className="text-xs text-gray-500 dark:text-slate-400">
            {hist.loading ? '불러오는 중…' : `${hist.data.length.toLocaleString()}건 · ${range}`}
          </div>
          {canEdit() && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={fromYear}
                onChange={e => setFromYear(Number(e.target.value))}
                disabled={busy}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                {[1, 2, 3, 5, 10].map(y => (
                  <option key={y} value={thisYear - y + 1}>최근 {y}년</option>
                ))}
              </select>
              <button
                onClick={() => void runBackfill()}
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >{busy ? '수집 중…' : 'ECOS 백필'}</button>
              <button
                onClick={() => void runSync()}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >최신 보충</button>
            </div>
          )}
        </div>
        {(progress || collectErr) && (
          <div className={`mt-2 text-xs ${collectErr ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-slate-300'}`}>
            {collectErr ?? progress}
          </div>
        )}
        {busy && (
          <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            ECOS 응답이 연도당 20~30초 걸립니다. 창을 닫지 마세요.
          </div>
        )}
        {/* 결제 버퍼 — 목표 비율의 하한을 결정하므로 수집 패널과 같은 위치에 둔다 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-slate-700">
          <span className="text-xs font-medium text-gray-700 dark:text-slate-200">
            향후 3개월 외화 결제 예정액
          </span>
          {canEdit() ? (
            <>
              <input
                type="text"
                inputMode="numeric"
                value={bufDraft ?? (fxPayableUsd ? fxPayableUsd.toLocaleString() : '')}
                onChange={e => setBufDraft(e.target.value)}
                placeholder="예: 2,500,000"
                className="w-36 rounded border border-gray-300 bg-white px-2 py-1 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <span className="text-xs text-gray-500 dark:text-slate-400">USD</span>
              {bufDraft != null && (
                <button
                  onClick={() => void saveBuffer()}
                  disabled={bufSaving}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >{bufSaving ? '저장 중…' : '저장'}</button>
              )}
            </>
          ) : (
            <span className="text-xs tabular-nums text-gray-700 dark:text-slate-200">
              USD {fxPayableUsd.toLocaleString()}
            </span>
          )}
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            = {fmtKRW(fxPayableKRW)} · 이 금액만큼은 국면과 무관하게 보유(목표 비율 하한)
          </span>
        </div>

        {!hasData && !hist.loading && (
          <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            환율 이력이 없습니다. 국면 판정에는 최소 30영업일(변동성 Z-Score까지 쓰려면 약 272영업일)이
            필요하므로 <strong>ECOS 백필</strong>을 먼저 실행하세요.
          </div>
        )}
      </div>

      {tab === 'protocol' && (
        <ProtocolTab
          protocol={protocol}
          canEdit={canEdit()}
          userCode={user?.code ?? 'unknown'}
          onSave={(key, value) => params.set(key, value, null, user?.code ?? 'unknown')}
          onSaved={() => void params.refetch()}
        />
      )}

      {tab === 'backtest' && (
        <BacktestTab
          series={series}
          protocol={protocol}
          initialTotalKRW={policy.totalFundAvail}
          initialFxRatio={policy.totalFundAvail > 0 ? policy.fxTotalHoldings / policy.totalFundAvail : 0}
          fxPayableFx={fxPayableUsd}
          policyMinRatio={ctx.policyMinRatio}
          policyMaxRatio={ctx.policyMaxRatio}
        />
      )}

      {/* ② 국면 판정 */}
      {tab === 'regime' && signal ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 국면 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">현재 국면</div>
            <div className={`mt-1 text-2xl font-bold ${TREND_TONE[signal.regime.code.split('-')[0] as TrendCode]}`}>
              {TREND_LABEL[signal.regime.code.split('-')[0] as TrendCode]}
            </div>
            <div className="text-sm text-gray-600 dark:text-slate-300">
              {VOL_LABEL[signal.regime.code.split('-')[1] as VolCode]} · 코드 {signal.regime.code}
            </div>
            <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
              {signal.regime.confirmedDays}일 연속 유지
              {signal.regime.rawCode !== signal.regime.code && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  (당일 판정 {signal.regime.rawCode} — 확정 대기)
                </span>
              )}
            </div>
            <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-300">
              기준일 {signal.asOf} · 종가 {signal.indicators.close.toLocaleString()}원
              <span className="ml-1 text-gray-400 dark:text-slate-500">
                (평활 {signal.indicators.smoothed.toFixed(1)})
              </span>
            </div>
          </div>

          {/* 목표 비율 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">목표 외화 보유 비율</div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
              {pct(signal.decision.appliedTargetRatio)}
            </div>
            <div className="text-sm text-gray-600 dark:text-slate-300">
              현재 {pct(signal.decision.currentRatio)}
            </div>
            {signal.decision.clampedBy !== 'none' && (
              <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                국면 원안 {pct(signal.decision.rawTargetRatio)} →{' '}
                {signal.decision.clampedBy === 'buffer'
                  ? `결제 버퍼 하한(${pct(signal.decision.bufferFloorRatio)})으로 조정`
                  : '정책 밴드로 조정'}
              </div>
            )}
            {fxPayableUsd > 0 ? (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                결제 버퍼 하한 {pct(signal.decision.bufferFloorRatio)} · 향후 3개월 결제예정{' '}
                USD {fxPayableUsd.toLocaleString()} ({fmtKRW(fxPayableKRW)})
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                ⚠ 결제 예정액이 0이라 버퍼 하한이 없습니다 — 알고리즘이 전량 매도를 제안할 수 있습니다.
                정책 파라미터 <code>fx_payable_buffer_usd</code> 를 설정하세요.
              </div>
            )}
          </div>

          {/* 권고 조치 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">권고 조치</div>
            <div className={`mt-1 text-lg font-bold ${
              signal.decision.actionRequired
                ? signal.decision.suggestedTradeKRW < 0
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-red-600 dark:text-red-400'
                : 'text-gray-600 dark:text-slate-300'
            }`}>
              {signal.decision.action}
            </div>
            {signal.decision.actionRequired && (
              <div className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                {fmtKRW(Math.abs(signal.decision.suggestedTradeKRW))}
              </div>
            )}
            <div className="mt-3 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
              이 값은 <strong>제안</strong>이며 자동 집행되지 않습니다. 실행은 기존 외화 매각 지시
              워크플로우(발의 → 승인 → 완료)를 거칩니다.
            </div>
          </div>
        </div>
      ) : tab === 'regime' && hasData && !hist.loading ? (
        <div className={CARD}>
          <div className="text-sm text-gray-600 dark:text-slate-300">
            판정에 필요한 최소 표본(30영업일)이 부족합니다 — 현재 {hist.data.length}건.
          </div>
        </div>
      ) : null}

      {/* ③ 지표 */}
      {tab === 'regime' && signal && (
        <div className={CARD}>
          <div className="mb-3 text-sm font-semibold text-gray-800 dark:text-slate-100">지표</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['추세강도 (ER)', num(signal.indicators.trendER), '0~100, 높을수록 곧은 추세'],
              ['20일 순변동', pct(signal.indicators.netMovePct, 2), '크기 게이트'],
              ['MACD 히스토그램', num(signal.indicators.macdHist, 2), '추세 가속도'],
              ['연환산 변동성', pct(signal.indicators.annualVol, 2), '실현 변동성'],
              ['변동성 Z-Score', num(signal.indicators.volZ, 2), '≥1.0 이면 고변동'],
              ['볼린저 %B', num(signal.indicators.pctB, 2), '0=하단 1=상단'],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded bg-gray-50 p-2 dark:bg-slate-800">
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{label}</div>
                <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">{value}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500">{hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ④ 차트 */}
      {tab === 'regime' && chart.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
            환율 추이 · 볼린저 밴드 (최근 {chart.length}영업일)
          </div>
          <div className="h-72 md:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={54} />
                <Tooltip
                  formatter={(v, n) =>
                    [typeof v === 'number' ? v.toFixed(1) : String(v ?? '—'), String(n ?? '')]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="bbRange" stroke="none" fill="#3b82f6" fillOpacity={0.12} name="볼린저 밴드" />
                <Line type="monotone" dataKey="close"  stroke="#94a3b8" strokeWidth={1} dot={false} name="종가" />
                <Line type="monotone" dataKey="kalman" stroke="#2563eb" strokeWidth={2} dot={false} name="칼만 평활" />
                <Line type="monotone" dataKey="mid"    stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" dot={false} name="SMA20" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
            지표는 칼만 평활가 기준으로 계산합니다. 회색 선이 실제 고시 종가(ECOS 매매기준율)입니다.
          </div>
        </div>
      )}

      {hist.error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          이력 조회 오류: {hist.error}
        </div>
      )}
    </div>
  )
}
