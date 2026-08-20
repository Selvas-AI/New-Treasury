/**
 * FxRegimePage — 환율 국면 판정 대시보드
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 3
 * 세션26차 개편: docs/기획/FX리짐_정책이관_계획.md
 *
 * ⭐ 이 화면은 **실무 일상 화면**이다 — 매일 국면을 보고 환전 여부를 판단한다.
 *    정책 기준(밴드·프로토콜·운영 가정)은 **자금정책 관리 › FX 정책**에서만 편집하고,
 *    여기서는 🔒 배지와 함께 읽기 전용으로 보여준다.
 *    메뉴 접근은 `fx-regime` 슬러그를 명시 허용한 계정만 가능하다(기본 비공개).
 *
 * 구성:
 *   ① 데이터 수집 패널 — ECOS 백필 / 최신 보충 (이력이 없으면 자동으로 펼침)
 *   ② 국면 판정 카드   — 현재 국면 · 목표 비율 · 권고 조치
 *   ③ 지표 · 차트      — 원시 종가 + 칼만 평활 + 볼린저 밴드
 *
 * 판정 경로는 useFxRegime 훅 하나로 정책 화면과 공유한다 — 화면별로 다시 계산하지 말 것.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { useFxRegime } from '../hooks/useFxRegime'
import {
  backfillFxHistory, syncLatestFxHistory,
  type BackfillProgress,
} from '../hooks/useFxHistory'
import {
  kalmanSmooth, bollinger,
  TREND_LABEL, VOL_LABEL, CLAMP_LABEL,
  type TrendCode, type VolCode,
} from '../lib/fxRegime'
import { buildChartNarrative } from '../lib/fxChartNarrative'
import InfoTip from '../components/common/InfoTip'
import BacktestTab from '../components/fxRegime/BacktestTab'
import NarrativeModal from '../components/fxRegime/NarrativeModal'
import DecisionTab from '../components/fxRegime/DecisionTab'
import VerdictCard from '../components/fxRegime/VerdictCard'
import RegisterOrderPanel from '../components/fxRegime/RegisterOrderPanel'
import PendingOrdersCard from '../components/fxRegime/PendingOrdersCard'
import { buildVerdict } from '../lib/fxVerdict'
import { lossBudget, bepStats } from '../lib/fxPnl'
import { fmtKRW, generateUUID } from '../lib/format'
import { syncRegimeSnapshot, type RegimeSnapshotHistoryEntry } from '../lib/fxRegimeSnapshot'
import { restInsert } from '../lib/supabase'
import RegimeHistoryCard from '../components/fxRegime/RegimeHistoryCard'
import FxBandExceedCard from '../components/fx/FxBandExceedCard'
import { computeFxBandExceed, buildThresholdOrderPayload } from '../lib/fxBandExceed'
import { useFx } from '../hooks/useFx'
import { addBizDays, todayStr } from '../lib/bizDay'
import {
  REGIME_CURRENCIES as CURRENCIES,
  type FieldOwner,
  type FxTreasuryInputAdapter,
  type FxTreasuryInputs,
  type InputSource,
} from '../lib/fxRegimeInputs'
import type { FxCode } from '../types'

/**
 * 탭 순서 = **의사결정 흐름**을 따른다.
 *
 *   ① 현재 국면 진단 — 무슨 일이 벌어지고 있나        (매일)
 *   ② 환전 판단 집행 — 이번에 실제로 얼마를 팔 것인가  (권고 발생 시)
 *   ③ 규칙 검증      — 그 규칙이 옳은가               (정책 변경 검토 시)
 *
 * ⚠ 세션26차: 정책 프로토콜(기준) 탭은 **자금정책 관리 › FX 정책**으로 이관했다.
 *   실무 화면은 정책을 조회만 하고 바꾸지 않는다 — 여기에 편집 UI를 되살리지 말 것.
 */
type TabKey = 'regime' | 'decision' | 'backtest'
const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'regime',   label: '① 📊 현재 국면', hint: '진단 — 무슨 일이 벌어지고 있나' },
  { key: 'decision', label: '② 💰 환전 판단', hint: '집행 — 이번에 얼마를 팔 것인가' },
  // ⚠ "시뮬레이션"은 과거 재현을 연상시켜 실적으로 오독된다.
  //   실제로는 동일 조건 위에서 규칙끼리 겨루는 실험이므로 "규칙 검증"으로 부른다.
  { key: 'backtest', label: '③ ⚖️ 규칙 검증', hint: '검증 — 그 규칙이 옳은가 (과거 실적 재현 아님)' },
]

/** 추세 코드별 강조색 — 국내 관행(상승=빨강 / 하락=파랑) */
const TREND_TONE: Record<TrendCode, string> = {
  '1': 'text-red-600 dark:text-red-400',
  '2': 'text-red-500 dark:text-red-300',
  '3': 'text-slate-600 dark:text-slate-300',
  '4': 'text-blue-500 dark:text-blue-300',
  '5': 'text-blue-600 dark:text-blue-400',
}

/**
 * 천단위 콤마 + 소수점 2자리까지 표시하는 숫자 입력.
 *
 * `<input type="number">` 는 콤마를 넣을 수 없어 자릿수가 큰 금액(912,900,000,000)을
 * 눈으로 확인하기 어렵다. text 로 바꾸고, **편집 중에는 raw, 포커스가 빠지면 포맷**한다.
 * (편집 중에도 포맷하면 커서 위치가 튀어 입력이 어려워진다)
 *
 * ⚠ 모듈 레벨에 정의할 것 — 렌더 함수 안에 두면 매 렌더 remount 되어 포커스가 유실된다.
 */
function NumField({ value, onChange, disabled, placeholder, allowEmpty = false, onCommit }: {
  value:       number | null
  onChange:    (v: number | null) => void
  disabled?:   boolean
  placeholder?: string
  /** true 면 빈 값을 null 로 전달 (정책 밴드처럼 미설정을 구분해야 하는 항목) */
  allowEmpty?: boolean
  /** 포커스가 빠질 때 확정값을 전달 — 서버 저장이 필요한 필드에 사용 */
  onCommit?:   (v: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const display = draft != null
    ? draft
    : value == null || value === 0
      ? ''
      : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={display}
      onFocus={() => setDraft(value == null || value === 0 ? '' : String(value))}
      onChange={e => {
        const raw = e.target.value
        // 콤마·공백은 허용하고 숫자·소수점만 남긴다
        const cleaned = raw.replace(/[,\s]/g, '')
        if (cleaned !== '' && !/^\d*\.?\d*$/.test(cleaned)) return
        setDraft(raw)
        if (cleaned === '') { onChange(allowEmpty ? null : 0); return }
        const n = Number(cleaned)
        if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100) / 100)
      }}
      onBlur={() => { setDraft(null); onCommit?.(value) }}
      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums
                 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500
                 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100
                 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-400"
    />
  )
}

function TreasuryInputPanel({ source, onSourceChange, inputs, currency, canEdit, basket, userLabel, company }: {
  source: InputSource
  onSourceChange: (source: InputSource) => void
  inputs: FxTreasuryInputAdapter
  currency: string
  canEdit: boolean
  basket: { code: string; nativeAmount: number; krwAmount: number }[]
  userLabel: string
  company: string
}) {
  // 모든 탭에 공통으로 붙는 큰 입력 영역이므로 기본은 접어 결과 화면을 넓게 쓴다.
  const [open, setOpen] = useState(false)
  // 실무 입력(사실 기록)은 서버 저장이라 낙관적 표시를 위해 로컬 초안을 둔다.
  const [lossDraft, setLossDraft] = useState<number | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const sim = source === 'simulation'
  const setNumber = (key: keyof FxTreasuryInputs, v: number | null) => {
    inputs.updateInputs({ [key]: v ?? 0 })
  }

  /** 정책 소유 필드 — 실데이터 모드에서는 잠긴다. 시뮬레이션에서만 값을 바꿔볼 수 있다. */
  const locked = !sim

  async function saveLoss(v: number | null) {
    if (v == null || v === inputs.realizedLossThisQuarterKRW) return
    const err = await inputs.saveOpsInput({ realizedLossThisQuarterKRW: v }, userLabel)
    setSaveMsg(err ? `저장 실패: ${err}` : '저장되었습니다')
    if (err) setLossDraft(null)
  }

  return (
    <div className={`${CARD} ${sim ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">💰 자금·정책 입력</div>
        {!open && (
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            총자금 {fmtKRW(inputs.totalFundKRW)} · 외화비중 {(inputs.totalFundKRW > 0 ? inputs.portfolioFxHoldingKRW / inputs.totalFundKRW * 100 : 0).toFixed(1)}% · 밴드 {inputs.policyMinRatio == null ? '—' : `${(inputs.policyMinRatio * 100).toFixed(1)}%`}~{inputs.policyMaxRatio == null ? '—' : `${(inputs.policyMaxRatio * 100).toFixed(1)}%`}
          </div>
        )}
        <button type="button" onClick={() => setOpen(v => !v)}
          className="ml-auto rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-expanded={open}>
          {open ? '▲ 입력 접기' : '▼ 입력 펼치기'}
        </button>
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-slate-800">
          <button
            type="button"
            onClick={() => onSourceChange('live')}
            className={`rounded-md px-3 py-1.5 ${!sim ? 'bg-white font-semibold text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-400' : 'text-gray-500'}`}
          >실데이터</button>
          <button type="button" onClick={() => onSourceChange('simulation')}
            className={`rounded-md px-3 py-1.5 ${sim ? 'bg-white font-semibold text-amber-600 shadow-sm dark:bg-slate-700 dark:text-amber-400' : 'text-gray-500'}`}>
            🧪 시뮬레이션
          </button>
        </div>
      </div>

      {/* 시뮬레이션 모드 경고 — 이 화면의 모든 수치가 가정값이 된다 */}
      {sim && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/25 dark:text-amber-200">
          <strong>🧪 시뮬레이션 — 실제 권고가 아닙니다.</strong>
          <span>값을 바꿔도 저장되지 않으며 새로고침하면 사라집니다. 집행 판단은 실데이터 모드에서만 하세요.</span>
          {inputs.simulationDirty && (
            <button type="button" onClick={inputs.resetSimulation}
              className="ml-auto rounded border border-amber-400 px-2 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40">
              실데이터로 되돌리기
            </button>
          )}
        </div>
      )}

      {open && <>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <InputField label="정책 기준 총자금" unit="원" owner="treasury">
          <NumField value={inputs.totalFundKRW} disabled={locked}
            onChange={v => setNumber('totalFundKRW', v)} />
        </InputField>
        <InputField label="전사 외화 바구니" unit="원 환산" owner="treasury">
          <NumField value={inputs.portfolioFxHoldingKRW} disabled={locked}
            onChange={v => setNumber('portfolioFxHoldingKRW', v)} />
        </InputField>
        <InputField label={`${currency} 보유액`} unit={currency} owner="treasury">
          <NumField value={inputs.fxHoldingFx} disabled={locked}
            onChange={v => setNumber('fxHoldingFx', v)} />
        </InputField>
        <InputField label="월 외화 유입액" unit={currency} owner="policy">
          <NumField value={inputs.monthlyInflowFx} disabled={locked}
            onChange={v => setNumber('monthlyInflowFx', v)} />
        </InputField>
        <InputField label="향후 3개월 결제 버퍼" unit={currency} owner="policy">
          <NumField value={inputs.fxPayableFx} disabled={locked}
            onChange={v => setNumber('fxPayableFx', v)} />
        </InputField>
        <InputField label="정책 밴드 하한" unit="%" owner="policy">
          <NumField allowEmpty disabled={locked} placeholder="미설정"
            value={inputs.policyMinRatio == null ? null : inputs.policyMinRatio * 100}
            onChange={v => inputs.updateInputs({
              policyMinRatio: v == null ? null : Math.min(1, Math.max(0, v / 100)),
            })} />
        </InputField>
        <InputField label="정책 밴드 상한" unit="%" owner="policy">
          <NumField allowEmpty disabled={locked} placeholder="미설정"
            value={inputs.policyMaxRatio == null ? null : inputs.policyMaxRatio * 100}
            onChange={v => inputs.updateInputs({
              policyMaxRatio: v == null ? null : Math.min(1, Math.max(0, v / 100)),
            })} />
        </InputField>
        <InputField label="평균 취득환율" unit={`원/${currency}`} owner="treasury">
          <NumField value={inputs.avgAcquisitionRate} disabled={locked}
            onChange={v => setNumber('avgAcquisitionRate', v)} />
        </InputField>
        <InputField label="분기 손실 실현 한도" unit="원" owner="policy">
          <NumField value={inputs.quarterLossCapKRW} disabled={locked}
            onChange={v => setNumber('quarterLossCapKRW', v)} />
        </InputField>
        <InputField label="이번 분기 실현 손실" unit="원" owner="ops">
          <NumField
            value={lossDraft ?? inputs.realizedLossThisQuarterKRW}
            disabled={sim ? false : !canEdit}
            onChange={v => {
              if (sim) { setNumber('realizedLossThisQuarterKRW', v); return }
              setLossDraft(v ?? 0); setSaveMsg(null)
            }}
            onCommit={sim ? undefined : v => void saveLoss(v)}
          />
        </InputField>
      </div>
      {saveMsg && (
        <div className={`mt-2 text-[11px] ${saveMsg.startsWith('저장 실패') ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {saveMsg}
        </div>
      )}
      {!sim && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800 dark:bg-blue-900/25 dark:text-blue-200">
          🔒 <strong>정책</strong> 표시 항목은 정책회의 의결값입니다 — 이 화면에서 변경할 수 없습니다.
          🏦 <strong>조회</strong> 항목은 Treasury 실데이터입니다.
          <Link to={`/policy?tab=fx&company=${encodeURIComponent(company)}`}
            className="ml-auto rounded border border-blue-300 px-2 py-1 font-medium hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900/40">
            자금정책 관리에서 변경 →
          </Link>
        </div>
      )}
      <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>전사 외화 포트폴리오 바구니</strong><span>정책비중 {(inputs.totalFundKRW>0?inputs.portfolioFxHoldingKRW/inputs.totalFundKRW*100:0).toFixed(1)}% · 밴드 {inputs.policyMinRatio==null?'—':`${(inputs.policyMinRatio*100).toFixed(1)}%`}~{inputs.policyMaxRatio==null?'—':`${(inputs.policyMaxRatio*100).toFixed(1)}%`}</span></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{basket.map(row=><div key={row.code} className={`rounded p-2 ${row.code===currency?'bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/20':'bg-gray-50 dark:bg-slate-800'}`}><div className="text-[11px] font-semibold">{row.code}</div><div className="text-xs tabular-nums">{row.nativeAmount.toLocaleString()}</div><div className="text-[10px] text-gray-500">{fmtKRW(row.krwAmount)} · 바구니의 {inputs.portfolioFxHoldingKRW>0?(row.krwAmount/inputs.portfolioFxHoldingKRW*100).toFixed(1):'0.0'}%</div></div>)}</div>
        <div className="mt-2 text-[11px] text-gray-500">정책밴드는 이 바구니 전체를 총자금으로 나눈 값입니다. 통화 탭은 그중 어떤 통화를 실제로 환전할지 판단하며, 정기예금 등 잠긴 금액은 집행 가능액에서 다시 제외됩니다.</div>
      </div>
      <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
        {sim
          ? '실험용 가정값입니다. 저장되지 않으며 실제 권고·매각 지시에 반영되지 않습니다.'
          : '총자금·외화잔액·FIFO 장부환율은 Treasury 조회값이고, 정책 밴드와 운영 가정은 정책회의 의결값(policy_params)입니다.'}
        평균 취득환율은 FIFO 잔존 장부환율이며, 환전 시 실현손익을 함께 계산합니다(취득원가 이하 매도를 막지는 않습니다).
      </div>
      {!sim && (
        <div className="mt-1 text-[11px] text-blue-700 dark:text-blue-300">
          정책밴드는 모든 통화의 원화환산 합계 ÷ 전사 총자금으로 계산합니다. {currency} 탭은 바구니 전체 비중을 유지하면서 해당 통화의 환전 시점과 집행 가능 재고를 판단합니다.
        </div>
      )}
      {!sim && inputs.policyMinRatio == null && inputs.policyMaxRatio == null && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          ⚠ 정책 밴드가 설정되지 않았습니다 — 목표 비중에 정책 상·하한 제약이 걸리지 않습니다.
          자금정책 관리 &gt; FX 정책에서 밴드를 의결·저장하세요.
        </div>
      )}
      {inputs.policyMinRatio != null && inputs.policyMaxRatio != null && inputs.policyMinRatio > inputs.policyMaxRatio && (
        <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          정책 밴드 하한은 상한보다 클 수 없습니다.
        </div>
      )}
      {inputs.totalFundKRW <= 0 && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          가용 자금 총액을 입력해야 현재 비중과 정책 밴드 제약을 정확히 계산할 수 있습니다.
        </div>
      )}
      </>}
    </div>
  )
}

/** 필드 소유 주체 배지 — 누가 이 값을 바꿀 수 있는지 화면에서 바로 보이게 한다 */
const OWNER_BADGE: Record<FieldOwner, { label: string; title: string; cls: string }> = {
  policy: {
    label: '🔒 정책',
    title: '정책회의 의결값 — 자금정책 관리에서만 변경할 수 있습니다.',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  treasury: {
    label: '🏦 조회',
    title: 'Treasury 실데이터 조회값 — 직접 편집할 수 없습니다.',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  },
  ops: {
    label: '✏️ 실무',
    title: '실무 입력 항목 — 실제 발생한 사실을 기록합니다.',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
}

function InputField({ label, unit, owner, children }: {
  label: string; unit: string; owner: FieldOwner; children: ReactNode
}) {
  const badge = OWNER_BADGE[owner]
  return (
    <label className="text-xs text-gray-600 dark:text-slate-300">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          {label}
          <span title={badge.title} className={`rounded px-1 py-px text-[9px] font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
        </span>
        <span className="text-gray-400">{unit}</span>
      </span>
      {children}
    </label>
  )
}

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

/**
 * 자동 해석문의 **강조** 표기를 <strong> 으로 변환.
 * 마크다운 파서를 붙일 필요가 없는 최소 구현 — 굵게만 지원한다.
 */
function renderBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-bold text-gray-900 dark:text-slate-50">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  )
}

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
  const [showNarrative, setShowNarrative] = useState(false)
  // 근거 영역은 기본 접힘 — 결론만 보고 나가는 것이 정상 사용 경로다
  const [detailsOpen, setDetailsOpen] = useState(false)

  // ⭐ 실제 권고는 실데이터 모드에서만 나온다. 시뮬레이션은 저장되지 않는 실험 모드다.
  //    (세션26차 — 수동 입력으로 총자금까지 바꿔 권고를 만들 수 있던 잠금 우회 경로 차단)
  const [inputSource, setInputSource] = useState<InputSource>('live')
  const actualTradeHistory = useFxTradeHistory(company)
  // 밴드 초과분(KRW)을 통화 수량으로 환산할 때만 쓴다. 공유 캐시라 추가 GAS 호출 없음.
  const fxRates = useFx()
  // 이 통화에 걸린, 아직 전량 체결되지 않은 매각 지시 — 라이브 판정이 "조치 불필요"로
  // 바뀌어도 지시가 남아있는 한 계속 보여준다(세션26차 8일차 후속).
  //
  // ⚠ 과거엔 order_type==='regime' 만 봤다. 그런데 실무에서 진행 중인 매각은 대부분
  //   정책회의 의결(discretionary)이나 한도초과(threshold)로 등록된다 — 리짐이 아니라는
  //   이유로 숨기면 "300만불 중 200만불 체결, 잔여 100만불"이 화면 어디에도 안 보이는
  //   바로 그 문제가 그대로 재현된다(2026-08-20 리포트). 발생 경로와 무관하게 보여준다.
  const pendingRegimeOrders = useMemo(
    () => actualTradeHistory.data.filter(t => t.currency === currency && t.direction === 'sell'
      && (t.status === '발의' || t.status === '승인' || t.status === '부분체결')),
    [actualTradeHistory.data, currency])

  // 판정 전 경로는 useFxRegime 하나로 통일한다 — 정책 화면과 같은 숫자를 봐야 한다.
  const {
    hist, inputs: treasuryInputs, series, protocol, ctx, signal,
    fxPayableFx, fxPayableKRW, availableFx, basket: portfolioBasket, fxLots, params,
    policyData,
  } = useFxRegime(company, currency, inputSource, true)

  // ── 판정 스냅샷 기록 (Phase 4) ────────────────────────────────────
  // 대시보드·자금일보는 환율 이력 전체를 돌릴 수 없으므로, 실무 화면이 판정할 때
  // 결과 요약만 policy_params 에 남긴다. 이게 "권고 미이행 경과일"의 기산점이 된다.
  // ⚠ 시뮬레이션 값은 절대 기록하지 않는다 — 가정값이 전사 경보로 번진다.
  //
  // ⚠⚠ [실사고] 2026-08-18 재검증 중 발견 — 로딩 중 값으로 쓰면 since 가 오늘로 리셋된다.
  //   hist(환율 이력)와 policyData/fxLots(Treasury 실데이터)는 **서로 다른 속도로** 로드된다.
  //   series.length 가 30 을 넘어 signal 이 먼저 나오면, 그 시점 ctx.totalFundKRW 등은
  //   아직 policyData 가 로딩 중이라 0(fallback)이다 → suggestKRW=0 인 "가짜 조치 불필요"
  //   신호가 먼저 기록되어 since 가 삭제되고, 뒤이어 실제 신호가 오면 prevSuggest=0 으로
  //   보여 since 가 **오늘**로 재설정된다 — 실제로는 4영업일째 미이행이던 권고가
  //   1일차로 리셋되는 사고였다(메디아나 USD, since 8/14 → 8/18 로 되돌아감).
  //   반드시 policyData·fxLots·hist 가 전부 로딩을 끝낸 뒤에만 스냅샷을 쓴다.
  //
  //   ⚠⚠ 1차 수정(단순 !loading 체크)으로 재검증했더니 **재발**했다 — 원인은
  //   usePolicyDashboard 의 loading 초기값이 **false** 라는 것. 마운트 첫 렌더는
  //   effect(fetch)가 아직 시작되기도 전이라 loading=false·raw=EMPTY 상태이고,
  //   hist 가 이미 캐시로 준비돼 있으면 이 첫 렌더에서 signal 이 나온다 — 즉
  //   "!loading" 만으로는 로딩 시작 전과 로딩 완료 후를 구분하지 못한다.
  //   → 법인/통화가 바뀔 때마다 리셋되는 "로딩 중이었던 적이 있다" 플래그로 gate 한다.
  const treasuryLoadingNow = policyData.loading || fxLots.loading || hist.loading
  const sawTreasuryLoadingRef = useRef(false)
  const treasuryScopeRef = useRef(`${company}|${currency}`)
  if (treasuryScopeRef.current !== `${company}|${currency}`) {
    treasuryScopeRef.current = `${company}|${currency}`
    sawTreasuryLoadingRef.current = false   // 법인·통화 전환 시 새 로딩 사이클을 다시 확인해야 한다
  }
  if (treasuryLoadingNow) sawTreasuryLoadingRef.current = true
  const treasuryReady = sawTreasuryLoadingRef.current && !treasuryLoadingNow
  // 스냅샷이 실제로 바뀔 때만(=syncRegimeSnapshot 내부에서 write 가 일어날 때만) 이력 1건을
  // 남긴다 — "조치 카드 일자별 조회"(세션26차 7일차)의 데이터 소스.
  const recordRegimeHistory = useCallback(async (entry: RegimeSnapshotHistoryEntry) => {
    await restInsert('fx_regime_snapshot_history', {
      id: generateUUID(), company, currency: entry.currency,
      snapshot_date: entry.snapshotDate, target_pct: entry.targetPct, current_pct: entry.currentPct,
      suggest_krw: entry.suggestKRW, since_date: entry.sinceDate, captured_by: entry.capturedBy,
    })
  }, [company])
  const snapWrittenRef = useRef<string>('')
  useEffect(() => {
    if (inputSource !== 'live' || !signal || !canEdit() || !treasuryReady) return
    const suggest = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
      ? -signal.decision.suggestedTradeKRW : 0
    // 같은 판정을 중복 기록하지 않기 위한 렌더 단위 가드 (DB 레벨 비교는 sync 내부에서 한 번 더)
    const stamp = `${company}|${currency}|${signal.asOf}|${Math.round(suggest)}`
    if (snapWrittenRef.current === stamp) return
    snapWrittenRef.current = stamp
    void syncRegimeSnapshot(params, currency, {
      targetPct:  signal.decision.appliedTargetRatio == null ? null
        : Math.round(signal.decision.appliedTargetRatio * 1000) / 10,
      currentPct: Math.round(signal.decision.currentRatio * 1000) / 10,
      suggestKRW: suggest,
      asOf:       signal.asOf,
    }, todayStr(), user?.label ?? user?.code ?? 'system', recordRegimeHistory)
  }, [inputSource, signal, company, currency, params, canEdit, user, treasuryReady, recordRegimeHistory])

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

  const avgAcqRate = treasuryInputs.avgAcquisitionRate

  /**
   * 리짐 권고를 매각 지시로 등록 (세션26차 Phase 4).
   * 기존 워크플로우(발의 → 승인 → 완료)를 그대로 쓰고, 발생 경로만 `regime` 으로 구분한다.
   * 기한은 다른 매각 지시와 동일하게 **등록일 +3영업일**(환율과 무관하게 실행).
   */
  const registerRegimeOrder = useCallback(async (amountFx: number): Promise<string | null> => {
    if (!signal || amountFx <= 0) return '등록할 금액이 없습니다.'
    const rate = signal.indicators.close
    const acq  = treasuryInputs.avgAcquisitionRate > 0 ? treasuryInputs.avgAcquisitionRate : null
    const today = todayStr()
    const { error } = await actualTradeHistory.propose({
      company, trade_date: today, currency, direction: 'sell',
      amount_fx: amountFx,
      acq_rate: acq,
      trade_rate: rate,
      fx_pnl: acq != null ? Math.round((rate - acq) * amountFx) : null,
      amount_krw: Math.round(rate * amountFx),
      memo: `리짐 권고 자동 등록 — 국면 ${signal.regime.code}`
        + `${signal.level ? ` · 수준 ${signal.level.label}` : ''}`
        + ` · 목표 ${(signal.decision.appliedTargetRatio * 100).toFixed(1)}%`
        + ` / 현재 ${(signal.decision.currentRatio * 100).toFixed(1)}% (판정일 ${signal.asOf})`,
      created_by: user?.label ?? user?.code ?? 'unknown',
      due_date: addBizDays(today, 3),
      order_type: 'regime',
    })
    if (error) return error.message ?? '등록 실패'
    await actualTradeHistory.load()
    return null
  }, [signal, treasuryInputs.avgAcquisitionRate, company, currency, actualTradeHistory, user])

  /**
   * 정책 밴드 상한 초과분 매도 발의 (세션26차 11일차).
   *
   * 리짐 권고(`registerRegimeOrder`, order_type='regime')와는 **발생 사유가 다르다** —
   * 이건 "밴드를 넘겨 들고 있다"는 한도 위반이라 리짐이 조치 불필요라고 판정해도
   * 별도로 발의할 수 있어야 한다. 그래서 order_type='threshold' 로 구분해 남긴다.
   * payload 조립은 자금정책 화면과 동일하게 buildThresholdOrderPayload 하나로만 한다.
   */
  const registerThresholdOrder = useCallback(async (input: {
    currency: FxCode; amountFx: number; rate: number; excessKRW: number
  }): Promise<string | null> => {
    const { error } = await actualTradeHistory.propose(buildThresholdOrderPayload({
      company, currency: input.currency, amountFx: input.amountFx, rate: input.rate,
      acqRate: input.currency === currency && treasuryInputs.avgAcquisitionRate > 0
        ? treasuryInputs.avgAcquisitionRate : null,
      excessKRW: input.excessKRW,
      createdBy: user?.label ?? user?.code ?? 'unknown',
      origin: 'FX 리짐 전략',
    }))
    if (error) return error.message ?? '등록 실패'
    await actualTradeHistory.load()
    return null
  }, [company, currency, actualTradeHistory, treasuryInputs.avgAcquisitionRate, user])

  // 정책 밴드 상한 대비 전사 외화 보유 — 분자·분모는 usePolicyDashboard(SSOT) 그대로.
  const bandExceed = useMemo(() => computeFxBandExceed(policyData, params), [policyData, params])
  const marketRates = useMemo(() => Object.fromEntries(
    fxRates.rates.map(r => [r.code, r.rate])) as Partial<Record<FxCode, number>>, [fxRates.rates])

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

  // 분기 손실한도 기준 집행 가능액 — 조치 카드(VerdictCard)와 매각 지시 등록 패널이
  // 공유한다(둘 다 상단에 붙어 있으므로 계산을 한 곳에만 둔다).
  const decisionBudget = useMemo(() => {
    if (!signal) return null
    const rate = signal.indicators.close
    const suggestedKRW = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
      ? -signal.decision.suggestedTradeKRW : 0
    const requestedFx = rate > 0 ? Math.min(suggestedKRW / rate, availableFx) : 0
    const budget = lossBudget(
      treasuryInputs.quarterLossCapKRW,
      treasuryInputs.realizedLossThisQuarterKRW,
      requestedFx,
      treasuryInputs.fxHoldingFx,
      treasuryInputs.avgAcquisitionRate,
      rate,
    )
    return { rate, requestedFx, budget }
  }, [signal, availableFx, treasuryInputs.quarterLossCapKRW,
      treasuryInputs.realizedLossThisQuarterKRW, treasuryInputs.fxHoldingFx,
      treasuryInputs.avgAcquisitionRate])

  // ⭐ 오늘의 결론 — 화면 최상단. 이 카드 하나만 보고 나가도 업무가 되도록 한다.
  const verdict = useMemo(() => {
    if (!signal || !decisionBudget) return null
    const bep = treasuryInputs.avgAcquisitionRate > 0
      ? bepStats(series, treasuryInputs.avgAcquisitionRate, 750)
      : null
    return buildVerdict({
      signal, currency,
      holdingFx:   treasuryInputs.fxHoldingFx,
      avgCostRate: treasuryInputs.avgAcquisitionRate,
      allowedFx:   decisionBudget.budget.allowedFx,
      requestedFx: decisionBudget.requestedFx,
      pctDaysAboveBep: bep?.pctDaysAbove ?? null,
    })
  }, [signal, currency, series, decisionBudget,
      treasuryInputs.fxHoldingFx, treasuryInputs.avgAcquisitionRate])

  // 차트 자동 해석 — 지표값을 평이한 문장으로 변환 (fxChartNarrative)
  const narrative = useMemo(() => {
    if (!signal || chart.length === 0) return []
    return buildChartNarrative({
      indicators:   signal.indicators,
      regimeCode:   signal.regime.code,
      windowCloses: chart.map(c => c.close),
      level:        signal.level
        ? { anchorRate: signal.level.anchorRate, dev: signal.level.dev, grade: signal.level.grade }
        : null,
      currency,
    })
  }, [signal, chart, currency])

  const hasData = hist.data.length > 0
  const range = hasData ? `${hist.data[0].date} ~ ${hist.data[hist.data.length - 1].date}` : '—'

  return (
    <div className="space-y-4 p-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">FX 리짐 전략</h1>
        {inputSource === 'simulation' && (
          <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
            🧪 시뮬레이션 — 실제 권고 아님
          </span>
        )}
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

      {/* ⭐ 오늘의 결론 — 항상 최상단. 이것만 보고 나가도 업무가 되게 한다. */}
      {verdict && signal && (
        <VerdictCard
          verdict={verdict}
          asOf={signal.asOf}
          currency={currency}
          renderBold={renderBold}
          onOpenDetail={() => { setTab('decision'); setDetailsOpen(true) }}
          onOpenNarrative={() => setShowNarrative(true)}
        />
      )}

      {/* 매각 지시 등록/이행 현황 — 조치 카드 바로 아래, 화면 최상단(세션26차 7~8일차).
          실무자가 가장 필요로 하는 행동을 탭을 열지 않아도 바로 할 수 있게 한다.
          이미 이행 중인 지시가 있으면 신규 발의보다 그 지시의 진행 현황을 우선 보여준다
          — 라이브 판정이 도중에 "조치 불필요"로 바뀌어도 잔여 체결분을 추적할 수 있어야 한다. */}
      {pendingRegimeOrders.length > 0 ? (
        <PendingOrdersCard company={company} currency={currency} orders={pendingRegimeOrders} />
      ) : (
        inputSource === 'live' && canEdit() && signal && decisionBudget && decisionBudget.budget.allowedFx > 0 && (
          <RegisterOrderPanel
            currency={currency}
            company={company}
            allowedFx={decisionBudget.budget.allowedFx}
            rate={decisionBudget.rate}
            avgCostRate={treasuryInputs.avgAcquisitionRate}
            onRegister={registerRegimeOrder}
          />
        )
      )}

      {/* 정책 밴드 상한 초과 — 리짐 판정과 **별개**의 한도 위반 경로(세션26차 11일차).
          발의가 자금정책 메뉴에만 있어 실무 담당자가 초과를 인지해도 손쓸 수 없던 문제를
          해결한다. 리짐이 "조치 불필요"라고 해도 밴드를 넘겼으면 여기서 발의할 수 있다.
          ⚠ 시뮬레이션 모드에서는 발의 버튼을 열지 않는다(가정값 기반 지시 방지). */}
      <FxBandExceedCard
        data={bandExceed}
        marketRates={marketRates}
        canPropose={inputSource === 'live' && canEdit()}
        onPropose={registerThresholdOrder}
        footer={
          <p className="mt-3 text-[11px] text-gray-400">
            상한은 정책회의가 의결한 밴드(fx_target_max)입니다. 승인·체결은{' '}
            <Link to={`/fx-ledger/${company}?tab=orders`} className="text-blue-600 underline dark:text-blue-400">
              외화거래명세 › 외화매도이력
            </Link>
            에서 진행합니다.
          </p>
        }
      />

      {/* 조치 이력 — 과거 특정 날짜의 조치 카드 재조회(세션26차 7일차) */}
      <RegimeHistoryCard company={company} currency={currency} />

      {/* 근거를 보고 싶은 사람만 여는 영역 */}
      <details open={detailsOpen} onToggle={e => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none rounded-lg border border-gray-200 bg-white px-4 py-2.5
                            text-sm font-semibold text-gray-700 transition hover:bg-gray-50
                            dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          🔍 판단 근거와 설정 {detailsOpen ? '접기' : '보기'}
          <span className="ml-2 text-[11px] font-normal text-gray-400 dark:text-slate-500">
            지표 · 차트 · 손익 · 정책 · 검증
          </span>
        </summary>

        <div className="mt-3 space-y-4">
      {/* 탭 */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.hint}
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
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
            📥 환율 이력
            <InfoTip text={[
              '한국은행 ECOS의 공식 매매기준율 일별 데이터입니다. 회계·세무 기준과 동일한 출처라 사후 정산에도 그대로 씁니다.',
              '판정에는 최소 30영업일, 변동성 Z-Score까지 쓰려면 약 272영업일(약 1년 3개월)이 필요합니다.',
              '"최신 보충"은 마지막 저장일 이후 빠진 구간만 하루 1회 채웁니다.',
            ]} />
          </div>
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
        {!hasData && !hist.loading && (
          <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            환율 이력이 없습니다. 국면 판정에는 최소 30영업일(변동성 Z-Score까지 쓰려면 약 272영업일)이
            필요하므로 <strong>ECOS 백필</strong>을 먼저 실행하세요.
          </div>
        )}
      </div>

      <TreasuryInputPanel
        key={`${company}_${currency}`}
        source={inputSource}
        onSourceChange={setInputSource}
        inputs={treasuryInputs}
        currency={currency}
        canEdit={canEdit()}
        basket={portfolioBasket}
        userLabel={user?.label ?? user?.code ?? 'unknown'}
        company={company}
      />

      {tab === 'decision' && (
        <DecisionTab
          signal={signal}
          series={series}
          currency={currency}
          holdingFx={treasuryInputs.fxHoldingFx}
          availableFx={availableFx}
          avgCostRate={treasuryInputs.avgAcquisitionRate}
          quarterCapKRW={treasuryInputs.quarterLossCapKRW}
          usedLossKRW={treasuryInputs.realizedLossThisQuarterKRW}
        />
      )}

      {tab === 'backtest' && (
        <BacktestTab
          series={series}
          protocol={protocol}
          initialTotalKRW={treasuryInputs.totalFundKRW}
          initialFxHolding={treasuryInputs.fxHoldingFx}
          monthlyInflowFx={treasuryInputs.monthlyInflowFx}
          fxPayableFx={fxPayableFx}
          avgAcquisitionRate={treasuryInputs.avgAcquisitionRate}
          maxExposureKRW={0}
          policyMinRatio={ctx.policyMinRatio}
          policyMaxRatio={ctx.policyMaxRatio}
          actualTrades={actualTradeHistory.data}
          initialLots={fxLots.lots}
          currency={currency}
        />
      )}

      {/* ② 국면 판정 */}
      {tab === 'regime' && signal ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 국면 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
              현재 국면
              <InfoTip text={[
                '환율이 지금 어떤 상태인지를 두 가지로 나눠 봅니다.',
                '① 추세 — 오르는 중인가 내리는 중인가 (5단계)',
                '② 변동성 — 흔들림이 큰가 작은가 (2단계)',
                '하루 만에 바뀌면 매매가 잦아지므로, 2영업일 연속 같은 판정이 나와야 국면 전환을 확정합니다.',
              ]} /></div>
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
            {/* 수준(Level) — 추세와 독립된 축 */}
            {signal.level ? (
              <div className="mt-2 rounded bg-gray-50 px-2 py-1.5 dark:bg-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 dark:text-slate-400">
                    수준
                    <InfoTip text={[
                      '지금 환율이 비싼가 싼가를 나타냅니다. 추세(방향)와는 완전히 다른 축입니다.',
                      '기준점(앵커)은 최근 3년 중 시장이 가장 오래 머물렀던 박스권의 평균 환율입니다. 시장이 실제로 합의했던 가격대이므로 "정상 수준"의 대용으로 씁니다.',
                      '⭐ 수준이 방향을(팔 것인가), 추세가 속도를(언제·얼마나 빨리) 정합니다.',
                    ]} />
                  </span>
                  <span className={`text-sm font-bold ${
                    signal.level.dev >= 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
                  }`}>
                    {signal.level.label}
                  </span>
                  <span className="text-xs tabular-nums text-gray-600 dark:text-slate-300">
                    앵커 {signal.level.anchorRate.toLocaleString()}원 대비{' '}
                    {signal.level.dev >= 0 ? '+' : ''}{(signal.level.dev * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                ⚠ 앵커 미설정 — 수준(비싼가/싼가)을 판단하지 못해 <strong>구 국면 로직</strong>으로 동작 중입니다.
                정책 프로토콜 탭에서 앵커를 지정하세요.
              </div>
            )}
            <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-300">
              기준일 {signal.asOf} · 종가 {signal.indicators.close.toLocaleString()}원
              <span className="ml-1 text-gray-400 dark:text-slate-500">
                (평활 {signal.indicators.smoothed.toFixed(1)})
              </span>
            </div>
          </div>

          {/* 목표 비율 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
              목표 외화 보유 비율
              <InfoTip text={[
                '전체 가용자금 중 외화로 들고 있어야 할 비중입니다. 값이 낮을수록 더 많이 환전하라는 뜻입니다.',
                '수준×추세 매트릭스에서 원안이 나오고, 여기에 ①결제 버퍼 ②정책 밴드 ③노출 한도가 차례로 적용됩니다.',
                '알고리즘 제안이 정책 밴드를 넘을 수는 없습니다 — 충돌하면 정책이 이깁니다.',
              ]} /></div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
              {pct(signal.decision.appliedTargetRatio)}
            </div>
            <div className="text-sm text-gray-600 dark:text-slate-300">
              현재 {pct(signal.decision.currentRatio)}
            </div>
            {signal.decision.clampedBy !== 'none' && (
              <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {signal.level ? '수준×추세 원안' : '국면 원안'} {pct(signal.decision.rawTargetRatio)} →{' '}
                {CLAMP_LABEL[signal.decision.clampedBy]}
                {signal.decision.clampedBy === 'buffer' && `(${pct(signal.decision.bufferFloorRatio)})`}
                (으)로 조정
              </div>
            )}
            {fxPayableFx > 0 ? (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                결제 버퍼 하한 {pct(signal.decision.bufferFloorRatio)} · 향후 3개월 결제예정{' '}
                {currency} {fxPayableFx.toLocaleString()} ({fmtKRW(fxPayableKRW)})
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                ⚠ 결제 예정액이 0이라 버퍼 하한이 없습니다 — 알고리즘이 전량 매도를 제안할 수 있습니다.
                상단 수동 입력에서 결제 버퍼를 설정하세요.
              </div>
            )}
          </div>

          {/* 권고 조치 */}
          <div className={CARD}>
            <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
              권고 조치
              <InfoTip text={[
                '목표 비중과 현재 비중의 차이를 금액으로 환산한 값입니다.',
                '차이가 리밸런싱 밴드(기본 3%p) 이내면 "조치 불필요"로 표시해 잦은 소액 매매를 막습니다.',
                '⚠ 이 값은 제안일 뿐 자동 집행되지 않습니다. 실행은 기존 외화 매각 지시 워크플로우(발의→승인→완료)를 그대로 거칩니다.',
              ]} /></div>
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
                {signal.indicators.close > 0 && (
                  <span className="ml-1 text-xs text-gray-500 dark:text-slate-400">
                    ≈ {currency} {Math.round(Math.abs(signal.decision.suggestedTradeKRW) / signal.indicators.close).toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {/* 취득원가 대비 실현손익 — 손실이어도 차단하지 않고 금액을 명시한다 */}
            {signal.decision.expectedRealizedPnlKRW != null && (
              <div className={`mt-2 rounded px-2 py-1.5 text-[11px] leading-relaxed ${
                signal.decision.belowCost
                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                  : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
              }`}>
                {signal.decision.belowCost ? '⚠ ' : ''}
                이 환전은 약 <strong>{fmtKRW(Math.abs(signal.decision.expectedRealizedPnlKRW))}</strong>의
                환차{signal.decision.belowCost ? '손' : '익'}을 실현합니다
                <span className="ml-1 text-gray-500 dark:text-slate-400">
                  (취득 {avgAcqRate.toLocaleString()} → 매도 {signal.indicators.close.toLocaleString()})
                </span>
                {signal.decision.belowCost && (
                  <div className="mt-1">
                    사유: {CLAMP_LABEL[signal.decision.clampedBy]}
                    {signal.decision.clampedBy === 'none' && '수준·추세 판정에 따른 실현'}
                  </div>
                )}
              </div>
            )}
            {avgAcqRate <= 0 && signal.decision.actionRequired && (
              <div className="mt-2 text-[11px] text-gray-400 dark:text-slate-500">
                평균취득환율을 입력하면 이 환전의 실현손익을 함께 계산합니다.
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
            {([
              ['추세강도 (ER)', num(signal.indicators.trendER), '0~100, 높을수록 곧은 추세', [
                '20일 동안 "실제로 이동한 거리 ÷ 오르내린 거리 총합"입니다.',
                '100에 가까우면 한 방향으로 곧게 갔다는 뜻(강한 추세), 0에 가까우면 같은 자리를 왕복했다는 뜻(횡보)입니다.',
                '보통 25 미만이면 횡보, 45 이상이면 강한 추세로 봅니다.',
              ]],
              ['20일 순변동', pct(signal.indicators.netMovePct, 2), '크기 게이트', [
                '최근 20영업일 동안 환율이 실제로 몇 % 움직였는지입니다.',
                '추세강도만 보면 환율이 0.1원만 움직여도 "곧게 갔다"고 100점이 나올 수 있어, 크기 조건을 함께 겁니다.',
                '원/달러는 20일 무작위 변동폭이 약 2%라, 1.5% 미만 이동은 방향이 있어 보여도 노이즈로 간주합니다.',
              ]],
              ['MACD 히스토그램', num(signal.indicators.macdHist, 2), '추세 가속도', [
                '단기 평균과 장기 평균의 격차가 벌어지는지 좁혀지는지를 봅니다.',
                '양수면 상승에 힘이 붙는 중, 음수면 하락에 힘이 붙는 중입니다.',
                '추세의 방향이 아니라 "가속 여부"를 확인하는 보조 지표입니다.',
              ]],
              ['연환산 변동성', pct(signal.indicators.annualVol, 2), '실현 변동성', [
                '최근 20일의 등락 폭을 1년 기준으로 환산한 값입니다. 원/달러는 통상 6~10% 범위입니다.',
                '⚠ 이 값은 평활 처리하지 않은 실제 고시 환율로 계산합니다. 평활가로 재면 변동성이 사라져 항상 과소평가됩니다.',
              ]],
              ['변동성 Z-Score', num(signal.indicators.volZ, 2), '≥1.0 이면 고변동', [
                '지금의 변동성이 지난 1년 분포에서 어디쯤인지를 표준편차 단위로 나타냅니다.',
                '0이면 평소 수준, 1.0 이상이면 평소보다 뚜렷하게 출렁이는 국면(고변동성 A)입니다.',
                '고변동 국면에서는 한 번에 몰아서 환전하지 않고 나눠서 집행하는 근거가 됩니다.',
              ]],
              ['볼린저 %B', num(signal.indicators.pctB, 2), '0=하단 1=상단', [
                '최근 20일 평균을 중심으로 ±2 표준편차 띠를 그렸을 때, 현재 환율이 그 띠의 어디에 있는지입니다.',
                '0이면 띠 하단, 1이면 상단, 0.5면 한가운데입니다. 0 미만이나 1 초과면 통계적으로 이례적인 구간입니다.',
              ]],
            ] as [string, string, string, string[]][]).map(([label, value, hint, tip]) => (
              <div key={label} className="rounded bg-gray-50 p-2 dark:bg-slate-800">
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  {label}<InfoTip text={tip} />
                </div>
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
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
              환율 추이 · 볼린저 밴드 (최근 {chart.length}영업일)
            </div>
            <button
              onClick={() => setShowNarrative(true)}
              disabled={narrative.length === 0}
              className="ml-auto rounded-full border border-blue-400 bg-blue-50 px-3 py-1 text-xs font-semibold
                         text-blue-700 transition hover:bg-blue-100 disabled:opacity-40
                         dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >📖 이 그래프 해석 보기</button>
          </div>

          <div className="h-72 md:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-slate-700" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={54} />
                <Tooltip
                  formatter={(v, n) => {
                    // ⚠ 볼린저 밴드는 [하단, 상단] 배열이라 그대로 두면
                    //   "1426.0303932232516,1486.7796067767488" 처럼 소수점이 그대로 노출된다.
                    if (Array.isArray(v)) {
                      const [lo, hi] = v as [number, number]
                      return [`${lo.toFixed(1)} ~ ${hi.toFixed(1)}원`, String(n ?? '')]
                    }
                    return [typeof v === 'number' ? `${v.toFixed(1)}원` : String(v ?? '—'), String(n ?? '')]
                  }}
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

        </div>
      </details>

      {hist.error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          이력 조회 오류: {hist.error}
        </div>
      )}

      <NarrativeModal
        open={showNarrative}
        onClose={() => setShowNarrative(false)}
        sections={narrative}
        subtitle={signal ? `${signal.asOf} 기준 · ${currency}` : undefined}
        renderBold={renderBold}
      />
    </div>
  )
}
