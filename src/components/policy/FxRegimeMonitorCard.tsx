/**
 * FxRegimeMonitorCard — 회의체용 FX 리짐 이행 모니터링
 *
 * 세션26차 신규. 근거: docs/기획/FX리짐_정책이관_계획.md §4 (정책 화면 ②탭)
 *
 * 실무 화면(/fx-regime)의 결론을 **회의체 언어**로 요약한다.
 * 계산은 전부 useFxRegime(SSOT) 재사용 — 여기서 목표비중을 다시 계산하지 않는다.
 *
 * 보여주는 것:
 *   1. 현재 국면·수준 → 적용 목표 잔존비중 vs 현재 비중 (밴드 오버레이 게이지)
 *   2. 권고 환전액
 *   3. 환전 가능 재고(FIFO 잠금 반영) vs 권고액 — 재고 부족으로 이행 불가한 경우 구분
 *   4. 미완료 매각 지시 D-day
 *   5. 분기 손실실현 한도 소진율
 */
import { Link } from 'react-router-dom'
import { useFxRegime } from '../../hooks/useFxRegime'
import { useFxTradeHistory } from '../../hooks/useFxTradeHistory'
import { CLAMP_LABEL, TREND_LABEL, VOL_LABEL, type TrendCode, type VolCode } from '../../lib/fxRegime'
import { bizDaysBetween, todayStr } from '../../lib/bizDay'
import { fmtKRW } from '../../lib/format'
import type { Company } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800'

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}

/**
 * 목표·현재·정책밴드를 한 축에 겹쳐 보여주는 게이지.
 * 0~100% 고정 스케일 — 스케일이 값에 따라 움직이면 회의 중 비교가 불가능해진다.
 */
function BandGauge({ current, target, min, max }: {
  current: number; target: number | null; min: number | null; max: number | null
}) {
  const clamp = (v: number) => Math.min(100, Math.max(0, v * 100))
  return (
    <div className="mt-2">
      <div className="relative h-6 w-full rounded bg-gray-100 dark:bg-slate-700">
        {/* 정책 밴드 구간 */}
        {min != null && max != null && (
          <div className="absolute inset-y-0 rounded bg-blue-200/70 dark:bg-blue-900/50"
            style={{ left: `${clamp(min)}%`, width: `${Math.max(0, clamp(max) - clamp(min))}%` }} />
        )}
        {/* 현재 비중 */}
        <div className="absolute inset-y-0 left-0 rounded bg-slate-500/70 dark:bg-slate-400/60"
          style={{ width: `${clamp(current)}%` }} />
        {/* 리짐 목표 마커 */}
        {target != null && (
          <div className="absolute inset-y-0 w-0.5 bg-red-600 dark:bg-red-400"
            style={{ left: `${clamp(target)}%` }} title={`리짐 목표 ${pct(target)}`} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400 dark:text-slate-500">
        {[0, 25, 50, 75, 100].map(t => <span key={t}>{t}%</span>)}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600 dark:text-slate-300">
        <span><span className="inline-block h-2 w-3 rounded-sm bg-slate-500/70 align-middle" /> 현재 {pct(current)}</span>
        <span><span className="inline-block h-2 w-3 rounded-sm bg-blue-200 align-middle dark:bg-blue-900" /> 정책 밴드 {min == null ? '미설정' : `${pct(min)}~${pct(max)}`}</span>
        <span><span className="inline-block h-2 w-0.5 bg-red-600 align-middle dark:bg-red-400" /> 리짐 목표 {pct(target)}</span>
      </div>
    </div>
  )
}

export default function FxRegimeMonitorCard({ company, currency }: {
  company: Company
  currency: string
}) {
  // ⚠ autoSync=false — 실무 화면이 이미 보충한다. 여기서 켜면 같은 ECOS 호출이 중복된다.
  const { signal, inputs, availableFx, fxLots, hist, latestRate } =
    useFxRegime(company, currency, 'live', false)
  const trades = useFxTradeHistory(company)

  const pending = trades.data.filter(t => t.status !== '완료' && t.status !== '취소')
  const today = todayStr()

  const suggestedKRW = signal?.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
    ? -signal.decision.suggestedTradeKRW : 0
  const suggestedFx = latestRate > 0 ? suggestedKRW / latestRate : 0
  const shortFall = suggestedFx - availableFx   // 양수 = 재고 부족으로 전량 이행 불가

  const lossCap = inputs.quarterLossCapKRW
  const lossUsed = inputs.realizedLossThisQuarterKRW
  const lossPct = lossCap > 0 ? Math.min(100, (lossUsed / lossCap) * 100) : null

  if (hist.loading) {
    return <div className={CARD}><p className="text-sm text-gray-500 dark:text-slate-400">환율 이력 불러오는 중…</p></div>
  }

  if (!signal) {
    return (
      <div className={CARD}>
        <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">🧭 FX 리짐 이행 현황</p>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          판정에 필요한 환율 이력이 부족합니다(현재 {hist.data.length.toLocaleString()}건, 최소 30영업일).
          {' '}<Link to="/fx-regime" className="underline">환율 국면 화면</Link>에서 ECOS 백필을 먼저 실행하세요.
        </p>
      </div>
    )
  }

  const trend = signal.regime.code.split('-')[0] as TrendCode
  const vol   = signal.regime.code.split('-')[1] as VolCode

  return (
    <div className="space-y-4">
      {/* ── 국면 · 목표 vs 현재 ─────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">🧭 FX 리짐 이행 현황</h3>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            {currency} · 기준일 {signal.asOf} · 종가 {signal.indicators.close.toLocaleString()}원
          </span>
          <Link to={`/fx-regime/${encodeURIComponent(company)}`}
            className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600
                       hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            실무 화면 열기 →
          </Link>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">현재 국면</p>
            <p className="text-base font-bold text-gray-900 dark:text-slate-100">
              {TREND_LABEL[trend]} · {VOL_LABEL[vol]}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              코드 {signal.regime.code} · {signal.regime.confirmedDays}일 연속
            </p>
          </div>
          <div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">수준(앵커 대비)</p>
            {signal.level ? (
              <>
                <p className={`text-base font-bold ${signal.level.dev >= 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                  {signal.level.label}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-slate-400">
                  앵커 {signal.level.anchorRate.toLocaleString()}원 대비 {signal.level.dev >= 0 ? '+' : ''}
                  {(signal.level.dev * 100).toFixed(1)}%
                </p>
              </>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                ⚠ 앵커 미설정 — 구 국면 로직으로 동작 중. 정책 기준 탭에서 앵커를 지정하세요.
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">적용 목표 잔존비중</p>
            <p className="text-base font-bold text-gray-900 dark:text-slate-100">
              {pct(signal.decision.appliedTargetRatio)}
            </p>
            {signal.decision.clampedBy !== 'none' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                원안 {pct(signal.decision.rawTargetRatio)} → {CLAMP_LABEL[signal.decision.clampedBy]} 적용
              </p>
            )}
          </div>
        </div>

        <BandGauge
          current={signal.decision.currentRatio}
          target={signal.decision.appliedTargetRatio}
          min={inputs.policyMinRatio}
          max={inputs.policyMaxRatio}
        />
      </div>

      {/* ── 권고 · 재고 · 손실한도 ──────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">권고 조치</p>
          <p className={`mt-1 text-base font-bold ${
            signal.decision.actionRequired ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-slate-300'
          }`}>{signal.decision.action}</p>
          {suggestedKRW > 0 && (
            <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
              {fmtKRW(suggestedKRW)}
              <span className="ml-1 text-xs text-gray-500 dark:text-slate-400">
                ≈ {currency} {Math.round(suggestedFx).toLocaleString()}
              </span>
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
            제안이며 자동 집행되지 않습니다. 실행은 매각 지시(발의→승인→완료)를 거칩니다.
          </p>
        </div>

        <div className={CARD}>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">환전 가능 재고</p>
          <p className="mt-1 text-base font-bold text-gray-900 dark:text-slate-100">
            {currency} {Math.round(availableFx).toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            보유 {Math.round(inputs.fxHoldingFx).toLocaleString()} · 정기예금 만기 전 금액 제외
            {fxLots.lots.length === 0 && ' (FIFO 로트 미등록 — 보유액으로 대체)'}
          </p>
          {suggestedFx > 0 && shortFall > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/25 dark:text-amber-300">
              ⚠ 재고 부족 — 권고액 중 {currency} {Math.round(shortFall).toLocaleString()} 은
              만기 전 정기예금에 묶여 이번에 집행할 수 없습니다. <strong>실무 미이행이 아닙니다.</strong>
            </p>
          )}
        </div>

        <div className={CARD}>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">분기 손실 실현 한도</p>
          {lossCap > 0 ? (
            <>
              <p className="mt-1 text-base font-bold text-gray-900 dark:text-slate-100">
                {lossPct?.toFixed(0)}% 소진
              </p>
              <div className="mt-1 h-2 w-full rounded bg-gray-100 dark:bg-slate-700">
                <div className={`h-2 rounded ${(lossPct ?? 0) >= 80 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${lossPct ?? 0}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                {fmtKRW(lossUsed)} / {fmtKRW(lossCap)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              미설정 — 정책 기준 탭에서 한도를 정하면 소진율을 추적합니다.
            </p>
          )}
        </div>
      </div>

      {/* ── 미완료 매각 지시 ────────────────────────────────────── */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-gray-800 dark:text-slate-100">미완료 매각 지시</h4>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">{pending.length}건</span>
        </div>
        {pending.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">이행 대기 중인 매각 지시가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {pending.map(t => {
              // 기한이 없는 레거시 건은 D-day 를 계산하지 않는다 — 0일로 보이면 오해를 부른다.
              const dday = t.due_date ? bizDaysBetween(today, t.due_date) : null
              const overdue = dday != null && dday < 0
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded bg-gray-50 px-2 py-1.5 text-xs dark:bg-slate-700/50">
                  <span className="font-semibold text-gray-800 dark:text-slate-100">
                    {t.currency} {t.amount_fx.toLocaleString()}
                  </span>
                  <span className="text-gray-500 dark:text-slate-400">{t.trade_date} 발의 · {t.status}</span>
                  {dday != null && (
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${
                      overdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    }`}>
                      {overdue ? `기한 초과 D+${Math.abs(dday)}` : `D-${dday}`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
