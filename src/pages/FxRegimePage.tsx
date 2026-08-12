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
 * 자금 컨텍스트는 fxRegimeInputs 어댑터를 통해 법인별 수동 입력한다.
 * Treasury 실데이터 연동은 시그니처만 남기고 현재 범위에서는 비활성이다.
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { usePolicyParams } from '../hooks/usePolicyParams'
import { usePolicyDashboard } from '../hooks/usePolicyDashboard'
import { useFxLots } from '../hooks/useFxLots'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import {
  useFxHistory, backfillFxHistory, syncLatestFxHistory,
  type BackfillProgress,
} from '../hooks/useFxHistory'
import {
  evaluateRegime, kalmanSmooth, bollinger, protocolFromParams,
  TREND_LABEL, VOL_LABEL, CLAMP_LABEL,
  type RegimeSeriesPoint, type TrendCode, type VolCode,
} from '../lib/fxRegime'
import { buildChartNarrative } from '../lib/fxChartNarrative'
import InfoTip from '../components/common/InfoTip'
import ProtocolTab from '../components/fxRegime/ProtocolTab'
import BacktestTab from '../components/fxRegime/BacktestTab'
import NarrativeModal from '../components/fxRegime/NarrativeModal'
import DecisionTab from '../components/fxRegime/DecisionTab'
import VerdictCard from '../components/fxRegime/VerdictCard'
import { buildVerdict } from '../lib/fxVerdict'
import { lossBudget, bepStats } from '../lib/fxPnl'
import { fmtKRW } from '../lib/format'
import {
  useFxTreasuryInputs,
  type FxTreasuryInputAdapter,
  type FxTreasuryInputs,
  type InputSource,
} from '../lib/fxRegimeInputs'

/**
 * 탭 순서 = **의사결정 흐름**을 따른다.
 *
 *   ① 현재 국면   진단   — 무슨 일이 벌어지고 있나        (매일)
 *   ② 환전 판단   집행   — 이번에 실제로 얼마를 팔 것인가  (권고 발생 시)
 *   ③ 정책 프로토콜 기준 — 우리 규칙은 무엇인가            (분기)
 *   ④ 시뮬레이션   검증   — 그 규칙이 옳은가              (정책 변경 시)
 *
 * 앞 두 개는 실무자가 매일 쓰는 화면, 뒤 두 개는 회의체가 주기적으로 보는 화면이다.
 * 사용 빈도와 논리 순서가 일치한다.
 */
type TabKey = 'regime' | 'decision' | 'protocol' | 'backtest'
const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'regime',   label: '① 📊 현재 국면',    hint: '진단 — 무슨 일이 벌어지고 있나' },
  { key: 'decision', label: '② 💰 환전 판단',    hint: '집행 — 이번에 얼마를 팔 것인가' },
  { key: 'protocol', label: '③ 🎯 정책 프로토콜', hint: '기준 — 우리 규칙은 무엇인가' },
  // ⚠ "시뮬레이션"은 과거 재현을 연상시켜 실적으로 오독된다.
  //   실제로는 동일 조건 위에서 규칙끼리 겨루는 실험이므로 "규칙 검증"으로 부른다.
  { key: 'backtest', label: '④ ⚖️ 규칙 검증',   hint: '검증 — 그 규칙이 옳은가 (과거 실적 재현 아님)' },
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

/**
 * 천단위 콤마 + 소수점 2자리까지 표시하는 숫자 입력.
 *
 * `<input type="number">` 는 콤마를 넣을 수 없어 자릿수가 큰 금액(912,900,000,000)을
 * 눈으로 확인하기 어렵다. text 로 바꾸고, **편집 중에는 raw, 포커스가 빠지면 포맷**한다.
 * (편집 중에도 포맷하면 커서 위치가 튀어 입력이 어려워진다)
 *
 * ⚠ 모듈 레벨에 정의할 것 — 렌더 함수 안에 두면 매 렌더 remount 되어 포커스가 유실된다.
 */
function NumField({ value, onChange, disabled, placeholder, allowEmpty = false }: {
  value:       number | null
  onChange:    (v: number | null) => void
  disabled?:   boolean
  placeholder?: string
  /** true 면 빈 값을 null 로 전달 (정책 밴드처럼 미설정을 구분해야 하는 항목) */
  allowEmpty?: boolean
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
      onBlur={() => setDraft(null)}
      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
    />
  )
}

function TreasuryInputPanel({ source, onSourceChange, inputs, currency, canEdit, basket }: {
  source: InputSource
  onSourceChange: (source: InputSource) => void
  inputs: FxTreasuryInputAdapter
  currency: string
  canEdit: boolean
  basket: { code: string; nativeAmount: number; krwAmount: number }[]
}) {
  const setNumber = (key: keyof FxTreasuryInputs, v: number | null) => {
    inputs.updateInputs({ [key]: v ?? 0 })
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">💰 자금·정책 입력</div>
        <div className="ml-auto flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-slate-800">
          <button
            type="button"
            onClick={() => onSourceChange('manual')}
            className={`rounded-md px-3 py-1.5 ${source === 'manual' ? 'bg-white font-semibold text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-400' : 'text-gray-500'}`}
          >수동 입력</button>
          <button type="button" onClick={() => onSourceChange('treasury')}
            className={`rounded-md px-3 py-1.5 ${source === 'treasury' ? 'bg-white font-semibold text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-400' : 'text-gray-500'}`}>
            Treasury 연동
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <InputField label="정책 기준 총자금" unit="원">
          <NumField value={inputs.totalFundKRW} disabled={!canEdit || source === 'treasury'}
            onChange={v => setNumber('totalFundKRW', v)} />
        </InputField>
        <InputField label="전사 외화 바구니" unit="원 환산">
          <NumField value={inputs.portfolioFxHoldingKRW} disabled={!canEdit || source === 'treasury'}
            onChange={v => setNumber('portfolioFxHoldingKRW', v)} />
        </InputField>
        <InputField label={`${currency} 보유액`} unit={currency}>
          <NumField value={inputs.fxHoldingFx} disabled={!canEdit || source === 'treasury'}
            onChange={v => setNumber('fxHoldingFx', v)} />
        </InputField>
        <InputField label="월 외화 유입액" unit={currency}>
          <NumField value={inputs.monthlyInflowFx} disabled={!canEdit}
            onChange={v => setNumber('monthlyInflowFx', v)} />
        </InputField>
        <InputField label="향후 3개월 결제 버퍼" unit={currency}>
          <NumField value={inputs.fxPayableFx} disabled={!canEdit}
            onChange={v => setNumber('fxPayableFx', v)} />
        </InputField>
        <InputField label="정책 밴드 하한" unit="%">
          <NumField allowEmpty disabled={!canEdit || source === 'treasury'} placeholder="미설정"
            value={inputs.policyMinRatio == null ? null : inputs.policyMinRatio * 100}
            onChange={v => inputs.updateInputs({
              policyMinRatio: v == null ? null : Math.min(1, Math.max(0, v / 100)),
            })} />
        </InputField>
        <InputField label="정책 밴드 상한" unit="%">
          <NumField allowEmpty disabled={!canEdit || source === 'treasury'} placeholder="미설정"
            value={inputs.policyMaxRatio == null ? null : inputs.policyMaxRatio * 100}
            onChange={v => inputs.updateInputs({
              policyMaxRatio: v == null ? null : Math.min(1, Math.max(0, v / 100)),
            })} />
        </InputField>
        <InputField label="평균 취득환율" unit={`원/${currency}`}>
          <NumField value={inputs.avgAcquisitionRate} disabled={!canEdit || source === 'treasury'}
            onChange={v => setNumber('avgAcquisitionRate', v)} />
        </InputField>
        <InputField label="분기 손실 실현 한도" unit="원">
          <NumField value={inputs.quarterLossCapKRW} disabled={!canEdit}
            onChange={v => setNumber('quarterLossCapKRW', v)} />
        </InputField>
        <InputField label="이번 분기 실현 손실" unit="원">
          <NumField value={inputs.realizedLossThisQuarterKRW} disabled={!canEdit}
            onChange={v => setNumber('realizedLossThisQuarterKRW', v)} />
        </InputField>
      </div>
      <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>전사 외화 포트폴리오 바구니</strong><span>정책비중 {(inputs.totalFundKRW>0?inputs.portfolioFxHoldingKRW/inputs.totalFundKRW*100:0).toFixed(1)}% · 밴드 {inputs.policyMinRatio==null?'—':`${(inputs.policyMinRatio*100).toFixed(1)}%`}~{inputs.policyMaxRatio==null?'—':`${(inputs.policyMaxRatio*100).toFixed(1)}%`}</span></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{basket.map(row=><div key={row.code} className={`rounded p-2 ${row.code===currency?'bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/20':'bg-gray-50 dark:bg-slate-800'}`}><div className="text-[11px] font-semibold">{row.code}</div><div className="text-xs tabular-nums">{row.nativeAmount.toLocaleString()}</div><div className="text-[10px] text-gray-500">{fmtKRW(row.krwAmount)} · 바구니의 {inputs.portfolioFxHoldingKRW>0?(row.krwAmount/inputs.portfolioFxHoldingKRW*100).toFixed(1):'0.0'}%</div></div>)}</div>
        <div className="mt-2 text-[11px] text-gray-500">정책밴드는 이 바구니 전체를 총자금으로 나눈 값입니다. 통화 탭은 그중 어떤 통화를 실제로 환전할지 판단하며, 정기예금 등 잠긴 금액은 집행 가능액에서 다시 제외됩니다.</div>
      </div>
      <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
        {source === 'manual' ? '법인·통화별 브라우저에 자동 저장됩니다. Treasury 정책 파라미터에는 기록하지 않습니다.' : '총자금·외화잔액·정책밴드·FIFO 장부환율은 Treasury 조회값입니다. 나머지 운영 가정은 수동 입력값을 함께 사용합니다.'}
        평균 취득환율을 넣으면 환전 시 실현손익을 함께 계산합니다(취득원가 이하 매도를 막지는 않습니다).
      </div>
      {source === 'treasury' && (
        <div className="mt-1 text-[11px] text-blue-700 dark:text-blue-300">
          정책밴드는 모든 통화의 원화환산 합계 ÷ 전사 총자금으로 계산합니다. {currency} 탭은 바구니 전체 비중을 유지하면서 해당 통화의 환전 시점과 집행 가능 재고를 판단합니다.
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
    </div>
  )
}

function InputField({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <label className="text-xs text-gray-600 dark:text-slate-300">
      <span className="flex justify-between gap-2"><span>{label}</span><span className="text-gray-400">{unit}</span></span>
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

  const hist   = useFxHistory(currency, { autoSync: true })
  const params = usePolicyParams(company)
  const policyData = usePolicyDashboard(company)
  const fxLots = useFxLots(company, currency)
  const actualTradeHistory = useFxTradeHistory(company)
  // Treasury 화면과 같은 잔액을 기본으로 사용한다. 수동값은 비교·가정용으로 유지한다.
  const [inputSource, setInputSource] = useState<InputSource>('treasury')
  const latestDaily = policyData.latestDaily as unknown as Record<string, unknown> | null
  const dailyFxField = `fx_${currency.toLowerCase()}`
  // daily.fx_usd 등 통화별 필드는 외화 원금이다. fx_krw만 전 통화 원화환산 합계다.
  const operatingFxNative = Number(latestDaily?.[dailyFxField] ?? 0)
  const treasuryNativeHolding = operatingFxNative +
    policyData.investments.filter(i => i.available === '가용' && i.currency === currency)
      .reduce((sum, i) => sum + (i.amount || 0), 0)
  const treasuryValues = useMemo<Partial<FxTreasuryInputs>>(() => ({
    totalFundKRW: policyData.fxPolicyDenominator,
    fxHoldingFx: fxLots.totalAmount > 0 ? fxLots.totalAmount : treasuryNativeHolding,
    portfolioFxHoldingKRW: policyData.fxPortfolioHoldings,
    policyMinRatio: params.get('fx_target_min') == null ? null : Number(params.get('fx_target_min')) / 100,
    policyMaxRatio: params.get('fx_target_max') == null ? null : Number(params.get('fx_target_max')) / 100,
    avgAcquisitionRate: fxLots.bookRate ?? 0,
  }), [policyData.fxPolicyDenominator, policyData.fxPortfolioHoldings, treasuryNativeHolding, fxLots.totalAmount, fxLots.bookRate, params])
  const treasuryInputs = useFxTreasuryInputs(inputSource, company, currency, treasuryValues)
  const portfolioBasket = useMemo(() => {
    if (inputSource === 'treasury') return Object.entries(policyData.fxByCurrency)
      .map(([code, row]) => ({ code, ...row }))
    const krwAmount = treasuryInputs.fxHoldingFx * (hist.data[hist.data.length - 1]?.rate ?? 0)
    return [{ code: currency, nativeAmount: treasuryInputs.fxHoldingFx, krwAmount }]
  }, [inputSource, policyData.fxByCurrency, treasuryInputs.fxHoldingFx, hist.data, currency])

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
  const fxPayableFx = treasuryInputs.fxPayableFx
  const latestRate = series[series.length - 1]?.rate ?? 0
  const fxPayableKRW = fxPayableFx * latestRate
  const fxHoldingKRW = treasuryInputs.portfolioFxHoldingKRW
  const validPolicyBand = treasuryInputs.policyMinRatio == null ||
    treasuryInputs.policyMaxRatio == null ||
    treasuryInputs.policyMinRatio <= treasuryInputs.policyMaxRatio

  const ctx = useMemo(() => ({
    totalFundKRW: treasuryInputs.totalFundKRW,
    fxHoldingKRW,
    // ⚠ 0 이면 버퍼 하한이 사라져 알고리즘이 전량 매도를 제안할 수 있다.
    fxPayableKRW,
    policyMaxRatio: validPolicyBand ? treasuryInputs.policyMaxRatio : null,
    policyMinRatio: validPolicyBand ? treasuryInputs.policyMinRatio : null,
    // 정책밴드 상한과 중복되는 고정 원화 노출 한도는 사용하지 않는다.
    maxExposureKRW: null,
    avgAcquisitionRate: treasuryInputs.avgAcquisitionRate > 0 ? treasuryInputs.avgAcquisitionRate : null,
    // 실시간 판정에는 "마지막 환전 이후 경과일" 이력이 없다 — 시간 기반 강제 환전은
    // 백테스트에서만 활성화된다. (매매 이력 연동 시 fx_trade_history 에서 산출 가능)
    daysSinceLastConvert: null,
  }), [treasuryInputs.totalFundKRW, fxHoldingKRW, fxPayableKRW,
    treasuryInputs.policyMaxRatio, treasuryInputs.policyMinRatio, validPolicyBand,
    treasuryInputs.avgAcquisitionRate])

  const avgAcqRate = treasuryInputs.avgAcquisitionRate

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

  // ⭐ 오늘의 결론 — 화면 최상단. 이 카드 하나만 보고 나가도 업무가 되도록 한다.
  const verdict = useMemo(() => {
    if (!signal) return null
    const rate = signal.indicators.close
    const suggestedKRW = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
      ? -signal.decision.suggestedTradeKRW : 0
    const availableFx = fxLots.totalAmount > 0 ? fxLots.availableAmount : treasuryInputs.fxHoldingFx
    const requestedFx = rate > 0 ? Math.min(suggestedKRW / rate, availableFx) : 0
    const budget = lossBudget(
      treasuryInputs.quarterLossCapKRW,
      treasuryInputs.realizedLossThisQuarterKRW,
      requestedFx,
      treasuryInputs.fxHoldingFx,
      treasuryInputs.avgAcquisitionRate,
      rate,
    )
    const bep = treasuryInputs.avgAcquisitionRate > 0
      ? bepStats(series, treasuryInputs.avgAcquisitionRate, 750)
      : null
    return buildVerdict({
      signal, currency,
      holdingFx:   treasuryInputs.fxHoldingFx,
      avgCostRate: treasuryInputs.avgAcquisitionRate,
      allowedFx:   budget.allowedFx,
      requestedFx,
      pctDaysAboveBep: bep?.pctDaysAbove ?? null,
    })
  }, [signal, currency, series, treasuryInputs.quarterLossCapKRW,
      treasuryInputs.realizedLossThisQuarterKRW, treasuryInputs.fxHoldingFx,
      treasuryInputs.avgAcquisitionRate, fxLots.totalAmount, fxLots.availableAmount])

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
        source={inputSource}
        onSourceChange={setInputSource}
        inputs={treasuryInputs}
        currency={currency}
        canEdit={canEdit()}
        basket={portfolioBasket}
      />

      {tab === 'decision' && (
        <DecisionTab
          signal={signal}
          series={series}
          currency={currency}
          holdingFx={treasuryInputs.fxHoldingFx}
          availableFx={fxLots.totalAmount > 0 ? fxLots.availableAmount : treasuryInputs.fxHoldingFx}
          avgCostRate={treasuryInputs.avgAcquisitionRate}
          quarterCapKRW={treasuryInputs.quarterLossCapKRW}
          usedLossKRW={treasuryInputs.realizedLossThisQuarterKRW}
        />
      )}

      {tab === 'protocol' && (
        <ProtocolTab
          protocol={protocol}
          series={series}
          context={ctx}
          currency={currency}
          currentSignal={signal}
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
