/**
 * ProtocolTab — 환율 국면별 정책 프로토콜 편집
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 4
 *
 * 국면별 목표 비율을 코드에 하드코딩하지 않는 이유:
 *   회사마다 외화 수급 구조가 다르고(순지출 vs 순수입), 이 값은 정책회의 의결 대상이다.
 *   → policy_params 에 저장하고, 변경 이력이 남도록 한다.
 *
 * ⚠ 저장 단위는 **%** 다 (0.35 가 아니라 35). 기존 fx_target_min/max 가 % 로 저장돼 있어
 *   단위를 섞으면 조용히 100배 틀린 값이 들어간다.
 */
import { useMemo, useState } from 'react'
import InfoTip from '../common/InfoTip'
import {
  ALL_REGIME_CODES, targetParamKey, PROTOCOL_PARAM_KEYS,
  regimeLabel, DEFAULT_TARGETS, DEFAULT_PROTOCOL,
  findConsolidationZones, levelTargetParamKey, classifyLevel,
  ALL_LEVEL_GRADES, ALL_TREND_GROUPS, LEVEL_LABEL, DEFAULT_LEVEL_TARGETS,
  evaluateRegime,
  type PolicyProtocol, type RegimeCode, type TrendCode,
  type RegimeSeriesPoint, type LevelGrade, type TrendGroup,
  type TreasuryContext, type FxRegimeSignal,
} from '../../lib/fxRegime'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

const TREND_TONE: Record<TrendCode, string> = {
  '1': 'text-red-600 dark:text-red-400',
  '2': 'text-red-500 dark:text-red-300',
  '3': 'text-slate-600 dark:text-slate-300',
  '4': 'text-blue-500 dark:text-blue-300',
  '5': 'text-blue-600 dark:text-blue-400',
}

interface ScalarField {
  key:   string
  label: string
  hint:  string
  /** 화면·저장 단위가 % 인지 */
  unit:  string
  value: number
  def:   number
  group: 'regime' | 'level' | 'execution'
  explain: string[]
}

export interface ProtocolTabProps {
  protocol:  PolicyProtocol
  canEdit:   boolean
  userCode:  string
  /** 앵커 후보 탐색용 환율 시계열 */
  series:    RegimeSeriesPoint[]
  context:   TreasuryContext
  currency:  string
  currentSignal: FxRegimeSignal | null
  /** 화면 상단에서 정한 전사 외화 정책밴드. 미설정은 null이다. */
  policyMinRatio: number | null
  policyMaxRatio: number | null
  /** usePolicyParams().set */
  onSave:    (key: string, value: number) => Promise<string | null>
  onSaved:   () => void
}

const TREND_GROUP_LABEL: Record<TrendGroup, string> = {
  up: '상승 ①②', side: '횡보 ③', down: '하락 ④⑤',
}

const GRADE_TONE: Record<LevelGrade, string> = {
  VH: 'text-red-600 dark:text-red-400',
  H:  'text-red-500 dark:text-red-300',
  N:  'text-slate-600 dark:text-slate-300',
  L:  'text-blue-500 dark:text-blue-300',
  VL: 'text-blue-600 dark:text-blue-400',
}

const LEVEL_POLICY_EXPLANATION: Record<LevelGrade, string> = {
  VH: '앵커보다 아주 비쌉니다. 좋은 가격을 놓치지 않도록 외화를 적게 남깁니다.',
  H:  '앵커보다 비쌉니다. 평소보다 더 환전해 이익을 나누어 확정합니다.',
  N:  '앵커와 비슷한 가격입니다. 어느 쪽에도 베팅하지 않고 중립 비중을 유지합니다.',
  L:  '앵커보다 쌉니다. 낮은 가격에 서둘러 팔지 않도록 외화를 더 남깁니다.',
  VL: '앵커보다 아주 쌉니다. 필수 환전 외에는 기다릴 수 있도록 가장 많이 남깁니다.',
}

function draftNumber(draft: Record<string, string>, key: string): number | null {
  if (!(key in draft)) return null
  const value = Number(String(draft[key]).replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** 저장 전 입력값을 메모리상의 프로토콜 복사본에만 적용한다. DB 쓰기는 하지 않는다. */
function protocolWithDraft(protocol: PolicyProtocol, draft: Record<string, string>): PolicyProtocol {
  const next: PolicyProtocol = {
    ...protocol,
    thresholds: { ...protocol.thresholds },
    targets: { ...protocol.targets },
    levelThresholds: { ...protocol.levelThresholds },
    levelTargets: {
      VH: { ...protocol.levelTargets.VH }, H: { ...protocol.levelTargets.H },
      N: { ...protocol.levelTargets.N }, L: { ...protocol.levelTargets.L },
      VL: { ...protocol.levelTargets.VL },
    },
  }

  for (const code of ALL_REGIME_CODES) {
    const v = draftNumber(draft, targetParamKey(code))
    if (v != null) next.targets[code] = v / 100
  }
  for (const grade of ALL_LEVEL_GRADES) {
    for (const group of ALL_TREND_GROUPS) {
      const v = draftNumber(draft, levelTargetParamKey(grade, group))
      if (v != null) next.levelTargets[grade][group] = v / 100
    }
  }

  const scalar = (key: string) => draftNumber(draft, key)
  const strong = scalar(PROTOCOL_PARAM_KEYS.strongTrendER)
  const weak = scalar(PROTOCOL_PARAM_KEYS.weakTrendER)
  const move = scalar(PROTOCOL_PARAM_KEYS.minTrendMovePct)
  const vol = scalar(PROTOCOL_PARAM_KEYS.highVolZ)
  const confirm = scalar(PROTOCOL_PARAM_KEYS.confirmDays)
  const band = scalar(PROTOCOL_PARAM_KEYS.rebalanceBandPct)
  const q = scalar(PROTOCOL_PARAM_KEYS.kalmanQ)
  const r = scalar(PROTOCOL_PARAM_KEYS.kalmanR)
  const vh = scalar(PROTOCOL_PARAM_KEYS.levelVhPct)
  const h = scalar(PROTOCOL_PARAM_KEYS.levelHPct)
  const l = scalar(PROTOCOL_PARAM_KEYS.levelLPct)
  const vl = scalar(PROTOCOL_PARAM_KEYS.levelVlPct)
  const force = scalar(PROTOCOL_PARAM_KEYS.forceConvertDays)

  if (strong != null) next.thresholds.strongTrendER = strong
  if (weak != null) next.thresholds.weakTrendER = weak
  if (move != null) next.thresholds.minTrendMovePct = move / 100
  if (vol != null) next.thresholds.highVolZ = vol
  if (confirm != null) next.confirmDays = confirm
  if (band != null) next.rebalanceBandPct = band / 100
  if (q != null) next.kalmanQ = q
  if (r != null) next.kalmanR = r
  if (vh != null) next.levelThresholds.vh = vh / 100
  if (h != null) next.levelThresholds.h = h / 100
  if (l != null) next.levelThresholds.l = l / 100
  if (vl != null) next.levelThresholds.vl = vl / 100
  if (force != null) next.forceConvertDays = force
  return next
}

function percent(value: number) { return `${(value * 100).toFixed(1)}%` }

function ActivePolicyPanel({ protocol, signal }: {
  protocol: PolicyProtocol
  signal: FxRegimeSignal | null
}) {
  const active = protocol.useLevelAxis && protocol.anchorRate != null
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${
      active
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
        : 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
    }`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
          active
            ? 'bg-emerald-600 text-white'
            : 'bg-amber-500 text-white'
        }`}>{active ? '현재 적용 중' : '주의'}</span>
        <strong className="text-sm text-gray-900 dark:text-slate-100">
          {active ? '실제 정책: 수준 × 추세 매트릭스' : '대조군: 수준 축 도입 전 로직이 적용 중'}
        </strong>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-gray-700 dark:text-slate-300">
        {active ? (
          signal?.level ? (
            <>
              현재 환율은 앵커 {signal.level.anchorRate.toLocaleString()}원 대비{' '}
              <strong>{signal.level.label}</strong>, 추세는 <strong>{signal.regime.label}</strong>입니다.
              {' '}정책 원안은 외화를 <strong>{percent(signal.decision.rawTargetRatio)} 남기는 것</strong>이며,
              제약 적용 후 목표는 <strong>{percent(signal.decision.appliedTargetRatio)}</strong>입니다.
            </>
          ) : '수준 × 추세 정책이 켜져 있으나 현재 판정 표본이 부족합니다.'
        ) : (
          '앵커가 없거나 수준 축이 꺼져 있어 검증 비교용 구 로직이 실제 결론에 사용되고 있습니다. 평상시에는 수준 × 추세 정책 사용을 권장합니다.'
        )}
      </div>
    </div>
  )
}

const SCALAR_GROUPS: { key: ScalarField['group']; title: string; description: string }[] = [
  {
    key: 'regime',
    title: '1. 국면 판정 — 추세와 변동성을 어떻게 구분할까?',
    description: '환율이 한쪽으로 꾸준히 가는지, 실제로 충분히 움직였는지, 평소보다 많이 흔들리는지를 차례로 확인합니다. 하루만 튄 움직임은 바로 믿지 않습니다.',
  },
  {
    key: 'level',
    title: '2. 수준 판정 — 어느 정도면 비싸거나 쌀까?',
    description: '현재 환율을 회사가 정한 기준점(앵커)과 비교합니다. 기준보다 얼마나 높거나 낮은지를 보고 다섯 단계 가격표를 붙입니다.',
  },
  {
    key: 'execution',
    title: '3. 집행 규칙 — 언제 실제 권고를 낼까?',
    description: '목표와 조금 다른 정도는 기다리고, 차이가 충분히 클 때만 환전을 권합니다. 너무 오래 쌓인 외화는 기한을 정해 일부 환전합니다.',
  },
]

function scalarRange(key: string): { min: number; max: number; step: number } {
  const ranges: Record<string, { min: number; max: number; step: number }> = {
    [PROTOCOL_PARAM_KEYS.strongTrendER]: { min: 0, max: 100, step: 1 },
    [PROTOCOL_PARAM_KEYS.weakTrendER]: { min: 0, max: 100, step: 1 },
    [PROTOCOL_PARAM_KEYS.minTrendMovePct]: { min: 0, max: 10, step: 0.1 },
    [PROTOCOL_PARAM_KEYS.highVolZ]: { min: 0, max: 3, step: 0.1 },
    [PROTOCOL_PARAM_KEYS.confirmDays]: { min: 1, max: 10, step: 1 },
    [PROTOCOL_PARAM_KEYS.rebalanceBandPct]: { min: 0, max: 20, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.kalmanQ]: { min: 0.1, max: 20, step: 0.1 },
    [PROTOCOL_PARAM_KEYS.kalmanR]: { min: 0.1, max: 50, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.levelVhPct]: { min: 0, max: 20, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.levelHPct]: { min: 0, max: 10, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.levelLPct]: { min: -10, max: 0, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.levelVlPct]: { min: -20, max: 0, step: 0.5 },
    [PROTOCOL_PARAM_KEYS.forceConvertDays]: { min: 0, max: 365, step: 5 },
  }
  return ranges[key] ?? { min: 0, max: 100, step: 1 }
}

function ScalarGroup({ group, fields, canEdit, draft, setD }: {
  group: (typeof SCALAR_GROUPS)[number]
  fields: ScalarField[]
  canEdit: boolean
  draft: Record<string, string>
  setD: (key: string, value: string) => void
}) {
  return (
    <section className="rounded-lg border border-gray-100 p-3 dark:border-slate-700">
      <h3 className="text-xs font-bold text-gray-800 dark:text-slate-100">{group.title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">{group.description}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(f => {
          const range = scalarRange(f.key)
          const rawSliderValue = Number(draft[f.key] ?? f.value)
          const sliderValue = Number.isFinite(rawSliderValue)
            ? Math.min(range.max, Math.max(range.min, rawSliderValue))
            : Math.min(range.max, Math.max(range.min, f.value))
          return (
          <div key={f.key} className="rounded bg-gray-50 p-2 dark:bg-slate-800">
            <div className="flex items-center text-[11px] font-medium text-gray-700 dark:text-slate-200">
              {f.label}
              <InfoTip text={f.explain} />
            </div>
            <div className="mt-1 flex items-center gap-1">
              {canEdit ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft[f.key] ?? String(f.value)}
                  onChange={e => setD(f.key, e.target.value)}
                  className="w-20 rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              ) : (
                <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">{f.value}</span>
              )}
              <span className="text-[11px] text-gray-500 dark:text-slate-400">{f.unit}</span>
              <span className="ml-auto text-[10px] text-blue-500 dark:text-blue-400">권장 {f.def}</span>
            </div>
            <div className="relative mt-2 px-0.5">
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={sliderValue}
                disabled={!canEdit}
                onChange={e => setD(f.key, e.target.value)}
                className="w-full accent-blue-600 disabled:cursor-default disabled:opacity-60"
                aria-label={`${f.label} 조정`}
              />
              <span
                className="pointer-events-none absolute top-[7px] h-2.5 w-0.5 -translate-x-1/2 rounded bg-blue-500"
                style={{ left: `${Math.min(100, Math.max(0, (f.def - range.min) / (range.max - range.min) * 100))}%` }}
                title={`권장값 ${f.def}${f.unit}`}
              />
            </div>
            <div className="mt-1 text-[10px] leading-tight text-gray-400 dark:text-slate-500">{f.hint}</div>
          </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * 앵커(기준 수준) 관리.
 *
 * ⚠ 후보는 **제시만** 한다. 자동 적용하면 데이터가 하루 늘 때마다 최적 구간이 바뀌어
 *   앵커가 점프하고, 목표 비중이 점프해 불필요한 매매가 발생한다.
 *   담당자가 선택해 policy_params 에 고정하고, 분기 1회 재검토한다.
 */
function AnchorPanel({ protocol, series, canEdit, onSave, onSaved, setErr }: {
  protocol: PolicyProtocol
  series:   RegimeSeriesPoint[]
  canEdit:  boolean
  onSave:   (key: string, value: number) => Promise<string | null>
  onSaved:  () => void
  setErr:   (m: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [showCands, setShowCands] = useState(false)
  const [customAnchor, setCustomAnchor] = useState('')

  const zones = useMemo(
    () => (showCands ? findConsolidationZones(series, { lookbackDays: 750, windowDays: 60, topN: 3 }) : []),
    [showCands, series],
  )

  const anchor = protocol.anchorRate
  const latest = series.length ? series[series.length - 1].rate : 0
  const dev = anchor && anchor > 0 ? (latest - anchor) / anchor : null

  async function pick(value: number) {
    setBusy(true); setErr(null)
    const e1 = await onSave(PROTOCOL_PARAM_KEYS.anchorRate, Math.round(value * 10) / 10)
    const e2 = e1 ? null : await onSave(PROTOCOL_PARAM_KEYS.useLevelAxis, 1)
    setBusy(false)
    if (e1 || e2) setErr(`앵커 저장 실패: ${e1 ?? e2}`)
    else { setShowCands(false); onSaved() }
  }

  async function toggleAxis(on: boolean) {
    setBusy(true); setErr(null)
    const e = await onSave(PROTOCOL_PARAM_KEYS.useLevelAxis, on ? 1 : 0)
    setBusy(false)
    if (e) setErr(`저장 실패: ${e}`); else onSaved()
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
          📐 기준 수준 (앵커)
          <InfoTip text={[
            '"지금 환율이 비싼가 싼가"를 판단하는 기준점입니다. 이 값이 없으면 높다·낮다를 말할 수 없습니다.',
            '최근 3년 중 시장이 좁은 범위에서 오래 머물렀던 구간(박스권)의 평균을 씁니다. 그 가격대가 시장이 실제로 합의했던 수준이기 때문입니다.',
            '⚠ 자동으로 바뀌지 않습니다. 담당자가 고른 값이 고정되며, 분기 1회 재검토가 필요합니다. 앵커 변경은 정책회의 의결 대상입니다.',
          ]} />
        </div>
        {anchor ? (
          <>
            <span className="rounded bg-blue-50 px-2 py-0.5 text-sm font-bold tabular-nums text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {anchor.toLocaleString()}원
            </span>
            {dev != null && (
              <span className={`text-sm font-semibold tabular-nums ${dev >= 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                현재 {latest.toLocaleString()}원 · {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(1)}%
              </span>
            )}
            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              protocol.useLevelAxis
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              수준 축 {protocol.useLevelAxis ? '사용 중' : '미사용'}
            </span>
          </>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            ⚠ 미설정 — 앵커가 없으면 &ldquo;높다/낮다&rdquo;를 판단할 수 없어 대조군 로직으로 동작합니다.
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex gap-2">
            {anchor != null && (
              <button
                onClick={() => void toggleAxis(!protocol.useLevelAxis)}
                disabled={busy}
                className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >{protocol.useLevelAxis ? '수준 축 끄기' : '수준 축 켜기'}</button>
            )}
            <button
              onClick={() => setShowCands(v => !v)}
              disabled={busy || series.length < 90}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >{showCands ? '닫기' : '횡보 구간 후보 찾기'}</button>
          </div>
        )}
      </div>

      {showCands && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
            최근 3년에서 <strong>밴드 폭이 좁고 제자리로 돌아온</strong> 60영업일 구간 상위 3개입니다.
            시장이 실제로 합의했던 가격대이므로 기준점으로 적합합니다. 선택하면 <strong>고정</strong>되며,
            다시 누르기 전까지 자동으로 바뀌지 않습니다.
            <div className="mt-1">
              ⚠ <strong>낮은 앵커를 고르면 손해</strong>입니다 — 모든 시점이 &ldquo;고가&rdquo;로 읽혀 너무 일찍 팔게 됩니다.
              실측(2026-08-11): 앵커 1,330.5 선택 시 실현환율 프리미엄이 +19.9원에 그친 반면
              1,378.0 은 +52.9원이었습니다(2026-07 구간). <strong>현재가 등급</strong> 열로 선택 결과를 미리 확인하세요.
            </div>
          </div>
          {/* 직접 입력 — 회의체가 정한 값이 따로 있을 수 있다 */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded bg-gray-50 p-2 dark:bg-slate-800">
            <span className="text-[11px] font-medium text-gray-700 dark:text-slate-200">직접 입력</span>
            <input
              type="number" min={0} step={0.1}
              value={customAnchor}
              onChange={e => setCustomAnchor(e.target.value)}
              placeholder="예: 1378.0"
              className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <span className="text-[11px] text-gray-500 dark:text-slate-400">원</span>
            {Number(customAnchor) > 0 && (
              <span className="text-[11px] tabular-nums text-gray-600 dark:text-slate-300">
                → 현재 {latest.toLocaleString()}원은{' '}
                <strong>{LEVEL_LABEL[classifyLevel(latest, Number(customAnchor), protocol.levelThresholds).grade]}</strong>
                {' '}({((latest - Number(customAnchor)) / Number(customAnchor) * 100).toFixed(1)}%)
              </span>
            )}
            <button
              onClick={() => void pick(Number(customAnchor))}
              disabled={busy || !(Number(customAnchor) > 0)}
              className="ml-auto rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >이 값으로 고정</button>
          </div>

          {zones.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-slate-400">후보를 찾지 못했습니다 (데이터 부족).</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-1.5">순위 · 구간</th>
                    <th className="py-1.5 text-right">평균(앵커 후보)</th>
                    <th className="py-1.5 text-right">폭</th>
                    <th className="py-1.5 text-right">ER</th>
                    <th className="py-1.5 text-right">현재가 등급</th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {zones.map((z, i) => {
                    const { dev, grade } = classifyLevel(latest, z.mean, protocol.levelThresholds)
                    return (
                      <tr key={z.from} className="border-b border-gray-100 dark:border-slate-800">
                        <td className="py-1.5">
                          <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            i === 0
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>{i + 1}순위</span>
                          {z.from} ~ {z.to}
                        </td>
                        <td className="py-1.5 text-right font-semibold">{z.mean.toFixed(1)}</td>
                        <td className="py-1.5 text-right">{(z.rangePct * 100).toFixed(2)}%</td>
                        <td className="py-1.5 text-right">{z.er.toFixed(1)}</td>
                        <td className={`py-1.5 text-right font-semibold ${GRADE_TONE[grade]}`}>
                          {LEVEL_LABEL[grade]}
                          <span className="ml-1 text-[10px] font-normal text-gray-400 dark:text-slate-500">
                            {dev >= 0 ? '+' : ''}{(dev * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => void pick(z.mean)}
                            disabled={busy}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >이 값으로 고정</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        ⚠ <strong>앵커 노후화 주의</strong> — 원/달러는 추세적으로 상승해 왔습니다.
        오래된 박스권을 앵커로 두면 &ldquo;현재는 영원히 고가&rdquo;로 판정되어 항상 최대 매도만 권고하게 되고,
        국면 판정의 변별력이 사라집니다. <strong>분기 1회 재검토</strong>하고, 편차가 오래 한쪽에만 머물면
        후보를 다시 찾으세요. 앵커 변경은 정책회의 의결 대상입니다.
      </div>
    </div>
  )
}

function PolicyRange({ label, help, value, min, max, recommended, onChange, disabled = false }: {
  label: string
  help: string
  value: number
  min: number
  max: number
  recommended: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const clamp = (value: number) => Math.min(max, Math.max(min, value))
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{label}</span>
        <span className="text-[10px] text-blue-500 dark:text-blue-400">권장 {recommended}%</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={event => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={label}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={event => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(clamp(next))
          }}
          className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-right text-xs font-bold tabular-nums disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-950"
        />
        <span className="text-xs text-gray-500 dark:text-slate-400">%</span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-gray-500 dark:text-slate-400">{help}</p>
    </div>
  )
}

function PolicyImpact({ minTarget, neutralTarget, maxTarget, widthDelta }: {
  minTarget: number
  neutralTarget: number
  maxTarget: number
  widthDelta: number
}) {
  const minDelta = minTarget - 15
  const neutralDelta = neutralTarget - 30
  const maxDelta = maxTarget - 42
  const lines: string[] = []

  if (neutralDelta > 0) {
    lines.push(`평상시에도 권장안보다 외화를 ${neutralDelta.toFixed(0)}%p 더 보유합니다. 반등 이익 기회는 커지지만 환율 하락 시 평가손실과 미환전 노출도 함께 커집니다.`)
  } else if (neutralDelta < 0) {
    lines.push(`평상시 외화를 권장안보다 ${Math.abs(neutralDelta).toFixed(0)}%p 덜 보유합니다. 원화 현금흐름은 안정되지만 이후 환율 상승 이익을 누릴 물량이 줄어듭니다.`)
  }
  if (minDelta < 0) {
    lines.push(`고가 구간의 최소 비중을 ${Math.abs(minDelta).toFixed(0)}%p 낮춰 이익을 더 적극적으로 확정합니다. 급락 방어에는 유리하지만 상승이 계속되면 너무 일찍 판 결과가 될 수 있습니다.`)
  } else if (minDelta > 0) {
    lines.push(`고가 구간에서도 권장안보다 ${minDelta.toFixed(0)}%p 더 남깁니다. 추가 상승은 누릴 수 있지만 고점에서 이익을 확정하지 못하고 되돌림을 맞을 위험이 커집니다.`)
  }
  if (maxDelta > 0) {
    lines.push(`저가 구간의 최대 비중을 ${maxDelta.toFixed(0)}%p 높였습니다. 낮은 가격에 파는 일을 줄이지만 외화가 더 많이 쌓여 최대 노출 한도가 중요해집니다.`)
  } else if (maxDelta < 0) {
    lines.push(`저가 구간에서도 권장안보다 ${Math.abs(maxDelta).toFixed(0)}%p 적게 남깁니다. 노출 위험은 줄지만 싼 가격에 환전해 반등 기회를 놓칠 가능성이 커집니다.`)
  }
  if (widthDelta > 0) {
    lines.push(`최소~최대 폭이 권장안보다 ${widthDelta.toFixed(0)}%p 넓습니다. 가격에 따라 더 크게 움직이는 공격적인 정책입니다.`)
  } else if (widthDelta < 0) {
    lines.push(`최소~최대 폭이 권장안보다 ${Math.abs(widthDelta).toFixed(0)}%p 좁습니다. 변화는 완만하지만 고가·저가에서 행동 차이가 작아져 환전 타이밍 효과가 약해질 수 있습니다.`)
  }

  return (
    <div className="mt-3 rounded-lg border-l-4 border-violet-500 bg-white p-3 text-xs leading-relaxed text-gray-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
      <div className="font-bold text-violet-700 dark:text-violet-300">💡 권장안 대비 정책 변화 안내</div>
      <div className="mt-1 font-semibold tabular-nums">
        권장 15% · 30% · 42% → 변경 {minTarget.toFixed(0)}% · {neutralTarget.toFixed(0)}% · {maxTarget.toFixed(0)}%
      </div>
      <ul className="mt-2 space-y-1">
        {lines.map(line => <li key={line}>• {line}</li>)}
      </ul>
      <div className="mt-2 text-[10px] text-gray-500 dark:text-slate-400">
        위 설명은 정책 구조상 예상되는 방향입니다. 실제 실현환율과 위험 크기는 저장 전에 ④ 규칙 검증에서 확인하세요.
      </div>
    </div>
  )
}

/** 수준 × 추세 목표 매트릭스 편집 */
function LevelMatrixPanel({ protocol, canEdit, draft, setD, policyMinRatio, policyMaxRatio }: {
  protocol: PolicyProtocol
  canEdit:  boolean
  draft:    Record<string, string>
  setD:     (key: string, v: string) => void
  policyMinRatio: number | null
  policyMaxRatio: number | null
}) {
  const recommendedMin = DEFAULT_LEVEL_TARGETS.VH.down * 100
  const recommendedNeutral = DEFAULT_LEVEL_TARGETS.N.side * 100
  const recommendedMax = DEFAULT_LEVEL_TARGETS.VL.up * 100
  const hasPolicyBand = policyMinRatio != null && policyMaxRatio != null && policyMinRatio <= policyMaxRatio
  // 정책밴드가 비어 있으면 회사별 과거 입력값 대신 검증된 권장 구조를 출발점으로 보여준다.
  const [minTarget, setMinTarget] = useState(hasPolicyBand ? protocol.levelTargets.VH.down * 100 : recommendedMin)
  const [neutralTarget, setNeutralTarget] = useState(hasPolicyBand ? protocol.levelTargets.N.side * 100 : recommendedNeutral)
  const [maxTarget, setMaxTarget] = useState(hasPolicyBand ? protocol.levelTargets.VL.up * 100 : recommendedMax)
  const [bandApplied, setBandApplied] = useState(false)

  function applyScale(nextMin: number, nextNeutral: number, nextMax: number) {
    setMinTarget(nextMin)
    setNeutralTarget(nextNeutral)
    setMaxTarget(nextMax)

    // 권장안의 각 칸이 최소~중립~최대 사이에서 차지하던 상대 위치를 그대로 보존한다.
    for (const grade of ALL_LEVEL_GRADES) {
      for (const group of ALL_TREND_GROUPS) {
        const recommended = DEFAULT_LEVEL_TARGETS[grade][group] * 100
        const scaled = recommended <= recommendedNeutral
          ? nextNeutral - ((recommendedNeutral - recommended) / (recommendedNeutral - recommendedMin)) * (nextNeutral - nextMin)
          : nextNeutral + ((recommended - recommendedNeutral) / (recommendedMax - recommendedNeutral)) * (nextMax - nextNeutral)
        setD(levelTargetParamKey(grade, group), scaled.toFixed(1))
      }
    }
  }

  const changedFromRecommended = Math.abs(minTarget - recommendedMin) > 0.01 ||
    Math.abs(neutralTarget - recommendedNeutral) > 0.01 ||
    Math.abs(maxTarget - recommendedMax) > 0.01
  const recommendedWidth = recommendedMax - recommendedMin
  const currentWidth = maxTarget - minTarget

  function applyPolicyBand() {
    if (!hasPolicyBand) return
    const nextMin = policyMinRatio * 100
    const nextMax = policyMaxRatio * 100
    // 권장 구조에서 중립이 최소~최대 사이에 있던 상대 위치(15/27)를 그대로 보존한다.
    const neutralPosition = (recommendedNeutral - recommendedMin) / (recommendedMax - recommendedMin)
    const nextNeutral = nextMin + (nextMax - nextMin) * neutralPosition
    applyScale(nextMin, nextNeutral, nextMax)
    setBandApplied(true)
  }

  return (
    <div className={CARD}>
      <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
        🎯 실제 정책: 환전 후 남길 외화 비중 — 수준 × 추세 (%)
        <InfoTip text={[
          '이 표가 시스템의 정책 그 자체입니다. 세로축은 "지금 비싼가", 가로축은 "오르는 중인가"입니다.',
          '숫자는 목표 외화 보유 비중이며, 낮을수록 더 많이 환전하라는 뜻입니다.',
          '예: 매우 높음 × 하락 = 15% → 비싼데 꺾이기 시작했으니 외화를 15%만 남기고 초과분을 환전하라는 뜻입니다.',
          '권장 범위 15~42%는 10~45%보다 외화 노출 폭을 23% 줄이면서도 검증 성과의 약 92%를 유지한 절충안입니다.',
          '범위를 너무 좁히면 고점에서 충분히 환전하지 못합니다. 24~34%에서는 2026-07 검증 실현환율이 기간평균보다 46원 낮았습니다.',
        ]} />
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
        이 숫자는 <strong>파는 비율이 아니라 환전 후 남길 비율</strong>입니다.
        예: 15%는 “15% 환전”이 아니라 <strong>외화를 15%만 남기고 초과분을 환전</strong>한다는 뜻입니다.
        {' '}<strong>수준이 방향을, 추세가 속도를 정하며 값이 낮을수록 많이 환전</strong>합니다.
        가장 강한 매도 신호는 <strong>매우 높음 × 하락</strong>이며, 2026-07 사고 상황이 여기 해당합니다.
        낮은 수준에서는 하락 추세여도 매도를 강제하지 않습니다.
      </div>
      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
        <strong>왜 이 숫자를 권장하나요?</strong>
        <div className="mt-1">
          가운데 30%를 평상시 기준으로 두고, 비쌀수록 적게 남기고 쌀수록 많이 남기도록 15~42% 범위를 만들었습니다.
          더 넓은 10~45%는 실현환율이 조금 좋아졌지만 외화 노출이 더 컸습니다. 현재 권장안은 노출 폭을 23% 줄이면서
          검증 성과는 약 92% 유지한 절충안입니다.
        </div>
        <div className="mt-1">
          반대로 범위를 너무 좁히면 안전해 보이지만 목표 차이가 작아져 고점에서도 환전을 거의 하지 않습니다.
          실제 검증에서 24~34% 범위는 2026-07 실현환율이 기간평균보다 46원 낮았습니다.
          따라서 이 값은 정답이 아니라 <strong>수익 기회와 외화 노출 위험 사이의 권장 출발점</strong>입니다.
        </div>
      </div>
      {canEdit && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-800 dark:bg-violet-950/20">
          <div className="flex items-center text-sm font-semibold text-gray-800 dark:text-slate-100">
            🎚️ 세 값으로 정책표 자동 조정
            <InfoTip text={[
              '15개 칸을 하나씩 입력하지 않아도 됩니다. 가장 많이 환전할 때 남길 최소 비중, 평상시 중립 비중, 가장 많이 보유할 때의 최대 비중만 정하세요.',
              '나머지 칸은 권장안에서 차지하던 상대 위치를 그대로 유지한 채 자동으로 계산됩니다. 그래서 정책표의 모양은 유지되고 전체 폭과 중심만 달라집니다.',
              '자동 조정 뒤에도 꼭 필요한 칸은 아래 표에서 따로 고칠 수 있습니다.',
            ]} />
            {hasPolicyBand && (
              <button
                type="button"
                onClick={applyPolicyBand}
                className="ml-auto rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-300"
              >{bandApplied ? '✓ 정책 상·하한 적용됨' : '정책 상·하한 비율 적용'}</button>
            )}
          </div>
          <div className="mt-1 text-[11px] text-gray-600 dark:text-slate-300">
            {hasPolicyBand ? (
              <>상단 정책밴드 <strong>{(policyMinRatio * 100).toFixed(1)}%~{(policyMaxRatio * 100).toFixed(1)}%</strong>는 버튼을 눌렀을 때 최소·최대에 적용됩니다. 중립은 권장 구조의 상대 위치로 자동 계산한 뒤 정책회의 의결에 따라 따로 조정할 수 있습니다.</>
            ) : (
              <>정책밴드가 비어 있어 권장 구조 <strong>최소 15% · 중립 30% · 최대 42%</strong>를 기본값으로 사용합니다.</>
            )}
            슬라이더를 움직이면 아래 15개 칸과 저장 전 미리보기가 즉시 바뀝니다.
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <PolicyRange
              label="최소 잔존 비중"
              help="환율이 매우 비싸고 하락할 때도 남겨둘 외화입니다. 낮출수록 고가에서 더 많이 환전합니다."
              value={minTarget}
              min={0}
              max={neutralTarget}
              recommended={recommendedMin}
              disabled={bandApplied}
              onChange={value => applyScale(value, neutralTarget, maxTarget)}
            />
            <PolicyRange
              label="중립 잔존 비중"
              help="환율이 앵커 근처일 때 유지할 평상시 기준입니다. 전체 정책표를 위아래로 움직이는 중심점입니다."
              value={neutralTarget}
              min={minTarget}
              max={maxTarget}
              recommended={recommendedNeutral}
              onChange={value => applyScale(minTarget, value, maxTarget)}
            />
            <PolicyRange
              label="최대 잔존 비중"
              help="환율이 매우 쌀 때 보유할 외화입니다. 높일수록 반등 기회는 커지지만 미환전 위험도 커집니다."
              value={maxTarget}
              min={neutralTarget}
              max={60}
              recommended={recommendedMax}
              disabled={bandApplied}
              onChange={value => applyScale(minTarget, neutralTarget, value)}
            />
          </div>
          {changedFromRecommended && (
            <PolicyImpact
              minTarget={minTarget}
              neutralTarget={neutralTarget}
              maxTarget={maxTarget}
              widthDelta={currentWidth - recommendedWidth}
            />
          )}
          {changedFromRecommended && (
            <button
              type="button"
              onClick={() => { setBandApplied(false); applyScale(recommendedMin, recommendedNeutral, recommendedMax) }}
              className="mt-2 text-[11px] font-medium text-violet-700 underline underline-offset-2 hover:text-violet-900 dark:text-violet-300"
            >권장안 15% · 30% · 42%로 되돌리기</button>
          )}
        </div>
      )}
      <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
        <div className="rounded bg-red-50 p-2 text-red-800 dark:bg-red-950/20 dark:text-red-300">
          <strong>상승 ①②</strong> — 더 오를 가능성을 조금 남겨두기 위해 같은 수준의 횡보 때보다 외화를 더 보유합니다.
        </div>
        <div className="rounded bg-gray-50 p-2 text-gray-700 dark:bg-slate-800 dark:text-slate-300">
          <strong>횡보 ③</strong> — 오름·내림 어느 쪽에도 베팅하지 않는 각 수준의 기준 비중입니다.
        </div>
        <div className="rounded bg-blue-50 p-2 text-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
          <strong>하락 ④⑤</strong> — 더 떨어질 위험을 줄이기 위해 같은 수준의 횡보 때보다 외화를 적게 남깁니다.
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-2 text-left">수준</th>
              {ALL_TREND_GROUPS.map(g => (
                <th key={g} className="py-2 text-right">{TREND_GROUP_LABEL[g]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_LEVEL_GRADES.map(grade => (
              <tr key={grade} className="border-b border-gray-100 dark:border-slate-800">
                <td className={`py-1.5 text-xs font-semibold ${GRADE_TONE[grade]}`}>
                  {grade} · {LEVEL_LABEL[grade]}
                  <div className="mt-0.5 max-w-52 text-[10px] font-normal leading-tight text-gray-400 dark:text-slate-500">
                    {LEVEL_POLICY_EXPLANATION[grade]}
                  </div>
                </td>
                {ALL_TREND_GROUPS.map(g => {
                  const key = levelTargetParamKey(grade, g)
                  const cur = protocol.levelTargets[grade][g] * 100
                  const def = DEFAULT_LEVEL_TARGETS[grade][g] * 100
                  const strongest = grade === 'VH' && g === 'down'
                  return (
                    <td key={g} className="py-1.5 text-right">
                      {canEdit ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draft[key] ?? cur.toFixed(1)}
                          onChange={e => setD(key, e.target.value)}
                          className={`w-20 rounded border px-2 py-0.5 text-right text-xs tabular-nums dark:bg-slate-800 dark:text-slate-100 ${
                            strongest
                              ? 'border-red-400 dark:border-red-500'
                              : 'border-gray-300 dark:border-slate-600'
                          }`}
                        />
                      ) : (
                        <span className="tabular-nums">{cur.toFixed(1)}</span>
                      )}
                      <div className="text-[10px] text-blue-500 dark:text-blue-400">권장 {def.toFixed(0)}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ProtocolTab({
  protocol, canEdit, userCode, series, context, currency, currentSignal,
  policyMinRatio, policyMaxRatio, onSave, onSaved,
}: ProtocolTabProps) {
  const [draft, setDraft]   = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const [rulesOpen, setRulesOpen] = useState(true)

  const scalars: ScalarField[] = [
    { key: PROTOCOL_PARAM_KEYS.strongTrendER, label: '강한 추세 기준 (ER)',
      hint: '45점 이상이면 강한 상승·하락 후보', unit: '',
      value: protocol.thresholds.strongTrendER, def: DEFAULT_PROTOCOL.thresholds.strongTrendER, group: 'regime',
      explain: ['환율이 20일 동안 한쪽으로 얼마나 곧게 움직였는지를 0~100점으로 봅니다. 45점 이상이면 강한 추세 후보입니다.', '권장 45는 작은 출렁임을 강한 추세로 오해하지 않으면서도 뚜렷한 움직임은 잡는 출발점입니다.', '더 높이면 확실할 때만 반응하지만 늦을 수 있고, 더 낮추면 빨리 반응하지만 가짜 신호가 늘어납니다.'] },
    { key: PROTOCOL_PARAM_KEYS.weakTrendER, label: '추세 인정 기준 (ER)',
      hint: '25점 미만이면 방향 없는 횡보', unit: '',
      value: protocol.thresholds.weakTrendER, def: DEFAULT_PROTOCOL.thresholds.weakTrendER, group: 'regime',
      explain: ['환율 움직임이 추세인지 제자리걸음인지 가르는 문턱입니다. 25점보다 낮으면 횡보로 봅니다.', '권장 25는 방향 없는 왕복 움직임을 상승·하락으로 잘못 부르는 일을 줄이기 위한 값입니다.', '더 높이면 횡보 판정이 많아지고, 더 낮추면 작은 움직임도 추세로 잡아 잦은 권고가 생길 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.minTrendMovePct, label: '최소 순변동폭',
      hint: '20일 실제 변화가 1.5%보다 작으면 횡보', unit: '%',
      value: protocol.thresholds.minTrendMovePct * 100, def: DEFAULT_PROTOCOL.thresholds.minTrendMovePct * 100, group: 'regime',
      explain: ['20일 동안 실제 환율이 최소 몇 % 움직여야 “움직였다”고 인정할지 정합니다.', '권장 1.5%는 원/달러의 평범한 20일 잡음보다 작은 움직임을 추세에서 빼기 위한 마지노선입니다.', '더 높이면 작은 추세를 놓칠 수 있고, 더 낮추면 0.1원씩 움직인 경우도 강한 추세로 잘못 볼 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.highVolZ, label: '고변동성 기준 (Z)',
      hint: '지난 1년의 평소보다 크게 흔들리면 고변동성', unit: '',
      value: protocol.thresholds.highVolZ, def: DEFAULT_PROTOCOL.thresholds.highVolZ, group: 'regime',
      explain: ['요즘 환율이 지난 1년의 평소보다 얼마나 더 심하게 흔들리는지 봅니다. 1이면 평소보다 눈에 띄게 큰 흔들림입니다.', '권장 1은 정말 불안한 시기만 고변동성 A로 구분하려는 보수적인 문턱입니다.', '더 높이면 A 판정이 드물어 위험을 늦게 알 수 있고, 더 낮추면 평범한 날도 위험하다고 자주 표시됩니다.'] },
    { key: PROTOCOL_PARAM_KEYS.confirmDays, label: '국면 확정 일수',
      hint: '같은 판단이 2일 이어져야 국면 변경', unit: '일',
      value: protocol.confirmDays, def: DEFAULT_PROTOCOL.confirmDays, group: 'regime',
      explain: ['새 국면이 며칠 연속 이어져야 진짜 바뀌었다고 믿을지 정합니다.', '권장 2일은 하루짜리 급등락은 걸러내되 변화에 너무 늦지 않게 반응하려는 절충안입니다.', '1일이면 빠르지만 오판이 늘고, 3일 이상이면 안정적이지만 중요한 전환을 늦게 알 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.rebalanceBandPct, label: '리밸런싱 밴드',
      hint: '목표와 3%p 이내 차이는 기다리고 환전하지 않음', unit: '%p',
      value: protocol.rebalanceBandPct * 100, def: DEFAULT_PROTOCOL.rebalanceBandPct * 100, group: 'execution',
      explain: ['현재 비중과 목표 비중의 차이가 이 숫자보다 작으면 “조금 다르지만 그냥 기다리자”고 판단합니다.', '권장 3%p는 작은 차이 때문에 자주 환전해 수수료가 쌓이는 것을 막는 완충지대입니다.', '더 작게 하면 목표를 촘촘히 따라가지만 거래가 늘고, 더 크게 하면 거래는 줄지만 좋은 환전 시점을 놓칠 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.kalmanQ, label: '흐름선 민첩함 (칼만 Q)',
      hint: '클수록 오늘 시장을 빨리 따라감', unit: '',
      value: protocol.kalmanQ, def: DEFAULT_PROTOCOL.kalmanQ, group: 'execution',
      explain: ['환율 흐름선이 오늘 시장을 얼마나 빨리 따라갈지 정하는 값입니다. 쉽게 말해 “민첩함”입니다.', '권장 Q=2는 원/달러에서 약 2영업일 안팎의 지연으로 잔떨림과 반응 속도를 절충한 값입니다.', '더 키우면 빨라지지만 작은 잡음에도 흔들리고, 더 줄이면 부드럽지만 추세 전환을 늦게 잡습니다. R과 함께 봐야 합니다.'] },
    { key: PROTOCOL_PARAM_KEYS.kalmanR, label: '흐름선 차분함 (칼만 R)',
      hint: '클수록 잔떨림을 무시하지만 반응은 늦어짐', unit: '',
      value: protocol.kalmanR, def: DEFAULT_PROTOCOL.kalmanR, group: 'execution',
      explain: ['오늘 환율의 작은 출렁임을 얼마나 잡음으로 보고 무시할지 정합니다. 쉽게 말해 “차분함”입니다.', '권장 R=10은 Q=2와 함께 쓸 때 잔떨림을 줄이면서 시장을 너무 늦게 따라가지 않도록 맞춘 값입니다.', '더 키우면 선은 매끈하지만 늦고, 더 줄이면 빠르지만 하루짜리 흔들림에 속기 쉽습니다. Q와 따로 바꾸지 않는 편이 안전합니다.'] },
    // ── Level 축 ──
    { key: PROTOCOL_PARAM_KEYS.levelVhPct, label: '매우 높음 기준',
      hint: '앵커보다 8% 이상 비싸면 매우 높음', unit: '%',
      value: protocol.levelThresholds.vh * 100, def: DEFAULT_PROTOCOL.levelThresholds.vh * 100, group: 'level',
      explain: ['현재 환율이 앵커보다 8% 이상 높으면 “매우 비쌈”으로 봅니다.', '권장 +8%는 단순히 조금 오른 정도가 아니라 이익 실현을 적극 검토할 만큼 멀어진 구간입니다.', '더 높이면 매우 비쌈 판정이 늦어 고점을 놓칠 수 있고, 더 낮추면 너무 일찍 많이 환전할 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.levelHPct, label: '높음 기준',
      hint: '앵커보다 3% 이상 비싸면 높음', unit: '%',
      value: protocol.levelThresholds.h * 100, def: DEFAULT_PROTOCOL.levelThresholds.h * 100, group: 'level',
      explain: ['현재 환율이 앵커보다 3% 이상 높으면 “비쌈”으로 봅니다.', '권장 +3%는 평소 범위를 벗어나기 시작한 것을 알아채되 작은 움직임에는 반응하지 않기 위한 값입니다.', '더 높이면 환전을 늦게 시작하고, 더 낮추면 조금만 올라도 비싸다고 판단해 상승 여력을 일찍 포기할 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.levelLPct, label: '낮음 기준',
      hint: '앵커보다 3% 이상 싸면 낮음', unit: '%',
      value: protocol.levelThresholds.l * 100, def: DEFAULT_PROTOCOL.levelThresholds.l * 100, group: 'level',
      explain: ['현재 환율이 앵커보다 3% 이상 낮으면 “쌈”으로 봅니다. 화면에는 -3으로 입력합니다.', '권장 -3%는 낮은 가격에 성급히 팔지 않도록 보유를 늘리기 시작하는 경계입니다.', '0에 가깝게 하면 자주 싸다고 판단해 외화가 쌓이고, 더 낮추면 싼 구간에서도 환전을 계속할 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.levelVlPct, label: '매우 낮음 기준',
      hint: '앵커보다 8% 이상 싸면 매우 낮음', unit: '%',
      value: protocol.levelThresholds.vl * 100, def: DEFAULT_PROTOCOL.levelThresholds.vl * 100, group: 'level',
      explain: ['현재 환율이 앵커보다 8% 이상 낮으면 “매우 쌈”으로 봅니다. 화면에는 -8로 입력합니다.', '권장 -8%는 환전을 크게 미뤄도 되는 극단적인 저가 구간을 평범한 하락과 구분합니다.', '0에 가깝게 하면 외화 노출이 너무 쉽게 커지고, 더 낮추면 매우 쌈 보호가 거의 작동하지 않을 수 있습니다.'] },
    { key: PROTOCOL_PARAM_KEYS.forceConvertDays, label: '강제 환전 기한',
      hint: '90일 넘게 쌓인 외화는 중립 비중까지 환전', unit: '일',
      value: protocol.forceConvertDays, def: DEFAULT_PROTOCOL.forceConvertDays, group: 'execution',
      explain: ['“환율이 싸다”는 이유로 외화를 끝없이 쌓아두지 않도록 기다릴 수 있는 최대 기간을 정합니다.', '권장 90일은 한 분기 동안은 기다릴 수 있게 하되 다음 분기까지 위험을 넘기지 않으려는 안전장치입니다.', '더 길면 반등을 기다릴 기회는 늘지만 손실 위험도 커지고, 더 짧으면 안전하지만 낮은 가격에 환전할 가능성이 커집니다. 0은 사용 안 함입니다.'] },
  ]

  const previewProtocol = useMemo(() => protocolWithDraft(protocol, draft), [protocol, draft])
  const previewSignal = useMemo(
    () => Object.keys(draft).length ? evaluateRegime(series, context, previewProtocol, currency) : null,
    [series, context, previewProtocol, currency, draft],
  )

  function setD(key: string, v: string) {
    setDraft(d => ({ ...d, [key]: v }))
    setMsg(null)
  }

  async function saveAll() {
    const entries = Object.entries(draft)
    if (!entries.length) return
    setSaving(true); setErr(null); setMsg(null)

    let ok = 0
    for (const [key, raw] of entries) {
      const v = Number(String(raw).replace(/,/g, ''))
      if (!Number.isFinite(v)) { setErr(`${key}: 숫자가 아닙니다`); setSaving(false); return }
      const e = await onSave(key, v)
      if (e) { setErr(`${key} 저장 실패: ${e}`); setSaving(false); return }
      ok++
    }
    setSaving(false)
    setDraft({})
    setMsg(`${ok}개 항목 저장 완료`)
    onSaved()
  }

  const dirty = Object.keys(draft).length > 0

  return (
    <div className="space-y-4">
      <ActivePolicyPanel protocol={protocol} signal={currentSignal} />

      <AnchorPanel
        protocol={protocol}
        series={series}
        canEdit={canEdit}
        onSave={onSave}
        onSaved={onSaved}
        setErr={setErr}
      />

      <LevelMatrixPanel
        protocol={protocol}
        canEdit={canEdit}
        draft={draft}
        setD={setD}
        policyMinRatio={policyMinRatio}
        policyMaxRatio={policyMaxRatio}
      />

      {previewSignal && currentSignal && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">저장 전 미리보기</span>
            <strong className="text-sm text-gray-900 dark:text-slate-100">이 변경이 오늘 결론에 미치는 영향</strong>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded bg-white/70 p-2 dark:bg-slate-900/50">
              <div className="text-gray-500 dark:text-slate-400">목표 잔존 비중</div>
              <div className="mt-0.5 font-bold text-gray-900 dark:text-slate-100">
                {percent(currentSignal.decision.appliedTargetRatio)} → {percent(previewSignal.decision.appliedTargetRatio)}
              </div>
            </div>
            <div className="rounded bg-white/70 p-2 dark:bg-slate-900/50">
              <div className="text-gray-500 dark:text-slate-400">권고 행동</div>
              <div className="mt-0.5 font-bold text-gray-900 dark:text-slate-100">
                {currentSignal.decision.action} → {previewSignal.decision.action}
              </div>
            </div>
            <div className="rounded bg-white/70 p-2 dark:bg-slate-900/50">
              <div className="text-gray-500 dark:text-slate-400">예상 조정금액</div>
              <div className="mt-0.5 font-bold tabular-nums text-gray-900 dark:text-slate-100">
                {Math.abs(currentSignal.decision.suggestedTradeKRW).toLocaleString()}원 →{' '}
                {Math.abs(previewSignal.decision.suggestedTradeKRW).toLocaleString()}원
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-blue-700 dark:text-blue-300">
            이 계산은 브라우저 메모리에서만 수행됩니다. 아래 저장 버튼을 누르기 전에는 정책값이 변경되지 않습니다.
          </div>
        </div>
      )}

      {canEdit && dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
          <span className="text-xs text-emerald-800 dark:text-emerald-300">
            아직 저장하지 않은 변경사항 <strong>{Object.keys(draft).length}개</strong>가 있습니다.
          </span>
          <button
            onClick={() => void saveAll()}
            disabled={saving}
            className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >{saving ? '저장 중…' : '검토한 변경사항 저장'}</button>
        </div>
      )}

      <details className={CARD}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-slate-100">
          🧪 대조군: 수준 축 도입 전 로직
          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            규칙 검증 비교용 · 평상시 미사용
          </span>
        </summary>
        <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
          이 표는 수준 축 도입 전 정책을 재현하는 <strong>대조군</strong>입니다.
          앵커가 설정되고 수준 축이 켜져 있으면 오늘의 결론에는 <strong>사용되지 않습니다.</strong>
          ④ 규칙 검증에서 새 정책이 실제로 개선됐는지 비교하기 위해 유지합니다.
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            이 값은 <strong>제안의 출발점</strong>일 뿐이며, 결제 버퍼 하한과 정책 밴드로 다시 조정됩니다.
          </div>
          {canEdit && dirty && (
            <button
              onClick={() => void saveAll()}
              disabled={saving}
              className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >{saving ? '저장 중…' : `변경사항 저장 (${Object.keys(draft).length})`}</button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
                <th className="py-2">국면</th>
                <th className="py-2">설명</th>
                <th className="py-2 text-right">목표 비율 (%)</th>
                <th className="py-2 text-right">권장 대조값</th>
              </tr>
            </thead>
            <tbody>
              {ALL_REGIME_CODES.map((code: RegimeCode) => {
                const key = targetParamKey(code)
                const cur = (protocol.targets[code] * 100)
                const def = (DEFAULT_TARGETS[code] * 100)
                const trend = code.split('-')[0] as TrendCode
                return (
                  <tr key={code} className="border-b border-gray-100 dark:border-slate-800">
                    <td className={`py-1.5 font-semibold ${TREND_TONE[trend]}`}>{code}</td>
                    <td className="py-1.5 text-xs text-gray-600 dark:text-slate-300">{regimeLabel(code)}</td>
                    <td className="py-1.5 text-right">
                      {canEdit ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draft[key] ?? cur.toFixed(1)}
                          onChange={e => setD(key, e.target.value)}
                          className="w-20 rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        <span className="tabular-nums">{cur.toFixed(1)}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-xs tabular-nums text-gray-400 dark:text-slate-500">
                      {def.toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      <div className={CARD}>
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">⚙️ 계산 기준과 집행 규칙</div>
          <button
            type="button"
            onClick={() => setRulesOpen(v => !v)}
            aria-expanded={rulesOpen}
            className="ml-auto rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >{rulesOpen ? '▲ 규칙 접기' : '▼ 규칙 펼치기'}</button>
        </div>
        {rulesOpen && <>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
          아래 값은 목표 보유비중이 아니라 <strong>국면·수준 판정 및 권고 실행 시점을 정하는 계산 상수</strong>입니다.
          권장안은 원/달러 데이터에 맞춘 <strong>안전한 출발점</strong>이지 영원한 정답이 아닙니다.
          각 물음표에서 왜 권장하는지와 값을 바꿀 때의 장단점을 확인하고, 확정 전 ④ 규칙 검증에서 비교하세요.
        </div>
        <div className="mt-3 space-y-3">
          {SCALAR_GROUPS.map(group => (
            <ScalarGroup
              key={group.key}
              group={group}
              fields={scalars.filter(field => field.group === group.key)}
              canEdit={canEdit}
              draft={draft}
              setD={setD}
            />
          ))}
        </div>
        {canEdit && dirty && (
          <button
            onClick={() => void saveAll()}
            disabled={saving}
            className="mt-3 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >{saving ? '저장 중…' : `변경사항 저장 (${Object.keys(draft).length})`}</button>
        )}
        {msg && <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{msg} · 변경자 {userCode}</div>}
        {err && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</div>}
        </>}
      </div>

      <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <strong>거버넌스</strong> — 이 프로토콜 변경은 자금정책회의 의결 대상입니다.
        값을 바꾸면 대시보드의 환전·환전 지연 권고가 즉시 달라지므로,
        변경 전 ④ 규칙 검증 결과를 회의체에 함께 보고하세요.
      </div>
    </div>
  )
}
