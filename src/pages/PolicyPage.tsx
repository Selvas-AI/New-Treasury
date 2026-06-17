import { useState, useMemo, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { usePolicyMeetings } from '../hooks/usePolicyMeetings'
import { usePolicyDecisions } from '../hooks/usePolicyDecisions'
import { usePolicyThreads } from '../hooks/usePolicyThreads'
import { usePolicyParams, usePolicyParamsReadMap, type PolicyParamReader } from '../hooks/usePolicyParams'
import { usePolicyDashboards, type PolicyRealData } from '../hooks/usePolicyDashboard'
import { useCompanies } from '../hooks/useCompanies'
import { getLatestBonds } from '../hooks/useInvestments'
import FxPolicyTab from '../components/policy/FxPolicyTab'
import FvplRiskTab from '../components/policy/FvplRiskTab'
import BankLimitsTab from '../components/policy/BankLimitsTab'
import CashflowForecastTab from '../components/policy/CashflowForecastTab'
import PolicyCTab from '../components/policy/PolicyCTab'
import { fmtKRW } from '../lib/format'
import { NumInput } from '../components/common/NumInput'
import type { Company, DecisionStatus, PolicyDecision } from '../types'

type PolicyTab = 'decisions' | 'fx' | 'fvpl' | 'banks' | 'forecast' | 'plan_c'

const STATUS_META: Record<DecisionStatus, { label: string; cls: string }> = {
  pending:     { label: '대기',   cls: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-100' },
  in_progress: { label: '진행중', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  completed:   { label: '완료',   cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
}

// 법인별 태그 색상 — 알려진 법인은 고정, 신규 법인은 이름 해시로 팔레트 순환
const COMPANY_TAG_PALETTE = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
]
const COMPANY_TAG_FIXED: Record<string, string> = {
  '셀바스에이아이': COMPANY_TAG_PALETTE[0],
  '셀바스헬스케어': COMPANY_TAG_PALETTE[1],
  '메디아나':       COMPANY_TAG_PALETTE[2],
}
function companyTag(company: string): string {
  if (COMPANY_TAG_FIXED[company]) return COMPANY_TAG_FIXED[company]
  let h = 0
  for (let i = 0; i < company.length; i++) h = (h * 31 + company.charCodeAt(i)) >>> 0
  return COMPANY_TAG_PALETTE[3 + (h % (COMPANY_TAG_PALETTE.length - 3))]
}

type ParamApi = ReturnType<typeof usePolicyParams>

// ── 게이지 바 컴포넌트 ─────────────────────────────────────────────────────
function GaugeBar({
  value, min, max, label, color = 'blue',
}: { value: number; min?: number; max?: number; label?: string; color?: string }) {
  const clampedPct = Math.min(Math.max(value, 0), 150)
  const barColor = color === 'green'
    ? 'bg-green-500' : color === 'red'
    ? 'bg-red-500' : color === 'orange'
    ? 'bg-orange-400' : 'bg-blue-500'

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs text-gray-500 dark:text-slate-300">
          <span>{label}</span>
          <span className="font-mono">{value.toFixed(1)}%</span>
        </div>
      )}
      <div className="relative h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(clampedPct, 100)}%` }}
        />
        {/* Target band markers */}
        {min !== undefined && (
          <div className="absolute top-0 h-full w-0.5 bg-gray-400 dark:bg-gray-500"
            style={{ left: `${Math.min(min, 100)}%` }} />
        )}
        {max !== undefined && (
          <div className="absolute top-0 h-full w-0.5 bg-gray-400 dark:bg-gray-500"
            style={{ left: `${Math.min(max, 100)}%` }} />
        )}
      </div>
      {(min !== undefined || max !== undefined) && (
        <div className="flex justify-between text-xs text-gray-400">
          <span>목표: {min ?? '?'}% ~ {max ?? '?'}%</span>
        </div>
      )}
    </div>
  )
}

// ── 상태 뱃지 ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: 'ok' | 'warn' | 'over' | 'na' }) {
  if (status === 'ok')   return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">✓ 정상</span>
  if (status === 'warn') return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 font-medium">⚠ 경고</span>
  if (status === 'over') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">✕ 초과</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300 font-medium">미설정</span>
}

// ── 유동성 버킷 카드 ──────────────────────────────────────────────────────
function LiquidityCard({
  data, params, isMaster, userLabel,
}: { data: PolicyRealData; params: ParamApi; isMaster: boolean; userLabel: string }) {
  const fixedCost  = params.get('liquidity_fixed_cost_monthly') ?? 0
  const minMonths  = params.get('liquidity_min_months') ?? 2
  const minTarget  = fixedCost * minMonths
  const creditLine = params.get('liquidity_credit_line') ?? 0

  const currentCash = data.operatingCash
  const ratio = minTarget > 0 ? (currentCash / minTarget) * 100 : null
  const status: 'ok' | 'warn' | 'over' | 'na' =
    minTarget === 0 ? 'na'
    : currentCash >= minTarget ? 'ok'
    : currentCash >= minTarget * 0.8 ? 'warn'
    : 'over'

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fixedCost: '', minMonths: '', creditLine: '' })

  function openEdit() {
    setForm({
      fixedCost:  fixedCost > 0 ? String(fixedCost / 1e8) : '',
      minMonths:  minMonths > 0 ? String(minMonths) : '',
      creditLine: creditLine > 0 ? String(creditLine / 1e8) : '',
    })
    setEditing(true)
  }

  async function handleSave() {
    const fc = parseFloat(form.fixedCost) * 1e8
    const mm = parseFloat(form.minMonths)
    const cl = parseFloat(form.creditLine || '0') * 1e8
    if (!isNaN(fc)) await params.set('liquidity_fixed_cost_monthly', fc, null, userLabel)
    if (!isNaN(mm)) await params.set('liquidity_min_months', mm, null, userLabel)
    if (!isNaN(cl)) await params.set('liquidity_credit_line', cl, null, userLabel)
    setEditing(false)
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800 dark:text-white">💧 유동성 버킷</span>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {isMaster && (
            <button onClick={openEdit}
              className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400">
              ✏️
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400 dark:text-slate-300">현재 원화 현금성</p>
          <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{fmtKRW(currentCash)}</p>
          <p className="text-gray-400 mt-0.5">보통예금+국책+MMDA</p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400 dark:text-slate-300">최소 유동성 한도</p>
          <p className={`font-semibold mt-0.5 ${minTarget === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
            {minTarget === 0 ? '미설정' : fmtKRW(minTarget)}
          </p>
          <p className="text-gray-400 mt-0.5">
            {fixedCost > 0 ? `월 고정비 × ${minMonths}개월` : '파라미터 미설정'}
          </p>
        </div>
      </div>

      {ratio !== null && (
        <GaugeBar
          value={ratio}
          label="충족률"
          color={status === 'ok' ? 'green' : status === 'warn' ? 'orange' : 'red'}
        />
      )}

      {creditLine > 0 && (
        <p className="text-xs text-gray-400">비상 차입 라인: {fmtKRW(creditLine)}</p>
      )}

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">유동성 버킷 설정</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500">월 고정비 (억원)</label>
                <NumInput value={form.fixedCost}
                  onChange={raw => setForm(p => ({ ...p, fixedCost: raw }))}
                  placeholder="예: 15 (= 15억)"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">최소 보유 개월</label>
                <input type="number" min="1" max="6" value={form.minMonths}
                  onChange={e => setForm(p => ({ ...p, minMonths: e.target.value }))}
                  placeholder="예: 2 (= 2개월분)"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">비상 차입 라인 (억원, 선택)</label>
                <NumInput value={form.creditLine}
                  onChange={raw => setForm(p => ({ ...p, creditLine: raw }))}
                  placeholder="예: 50 (= 50억)"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditing(false)}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100">
                취소
              </button>
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── FX 현황 카드 ──────────────────────────────────────────────────────────
function FxStatusCard({
  data, params, onNavigate,
}: { data: PolicyRealData; params: ParamApi; onNavigate?: () => void }) {
  const targetMin = params.get('fx_target_min')
  const targetMax = params.get('fx_target_max')
  const totalWithFx = data.operatingCashWithFx
  const fxRatio = totalWithFx > 0 ? (data.fxKrw / totalWithFx) * 100 : 0

  const status: 'ok' | 'warn' | 'over' | 'na' =
    targetMin === null || targetMax === null ? 'na'
    : fxRatio >= targetMin && fxRatio <= targetMax ? 'ok'
    : fxRatio < targetMin * 0.9 || fxRatio > targetMax * 1.1 ? 'over'
    : 'warn'

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800 dark:text-white">💱 외화 비중</span>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">현재 외화 비중</p>
          <p className="font-semibold text-gray-900 dark:text-white mt-0.5 text-base">
            {fxRatio.toFixed(1)}%
          </p>
          <p className="text-gray-400 mt-0.5">{fmtKRW(data.fxKrw)}</p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">Target Band</p>
          <p className={`font-semibold mt-0.5 text-base ${targetMin === null ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
            {targetMin !== null && targetMax !== null
              ? `${targetMin}% ~ ${targetMax}%`
              : '미설정'}
          </p>
          <p className="text-gray-400 mt-0.5">FxPage에서 편집</p>
        </div>
      </div>

      {targetMin !== null && targetMax !== null && (
        <GaugeBar value={fxRatio} min={targetMin} max={targetMax}
          color={status === 'ok' ? 'green' : status === 'warn' ? 'orange' : 'red'} />
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          운전자금 총액: {fmtKRW(totalWithFx)}
          {data.fxKrw === 0 && <span className="ml-1 text-orange-400">(외화 잔고 없음)</span>}
        </span>
        {onNavigate && (
          <button onClick={onNavigate} className="text-[10px] text-blue-500 hover:text-blue-700 dark:text-blue-400">
            FX 정책 →
          </button>
        )}
      </div>
    </div>
  )
}

// ── 차입금 현황 카드 ──────────────────────────────────────────────────────
function LoanStatusCard({
  data, params, isMaster, userLabel,
}: { data: PolicyRealData; params: ParamApi; isMaster: boolean; userLabel: string }) {
  const totalFund      = params.get('fx_total_fund') ?? data.totalFundEstimate
  const loanMaxRatio   = params.get('loan_max_total_ratio')
  const loanRatio      = totalFund > 0 ? (data.totalLoan / totalFund) * 100 : 0

  const status: 'ok' | 'warn' | 'over' | 'na' =
    loanMaxRatio === null ? 'na'
    : loanRatio <= loanMaxRatio ? 'ok'
    : loanRatio <= loanMaxRatio * 1.1 ? 'warn'
    : 'over'

  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

  async function handleSave() {
    const v = parseFloat(val)
    if (!isNaN(v) && v >= 0 && v <= 100) {
      await params.set('loan_max_total_ratio', v, null, userLabel)
      setEditing(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800 dark:text-white">🏦 차입금</span>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {isMaster && (
            <button onClick={() => { setVal(loanMaxRatio !== null ? String(loanMaxRatio) : ''); setEditing(true) }}
              className="text-xs text-gray-400 hover:text-blue-500">✏️</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">총 차입금</p>
          <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{fmtKRW(data.totalLoan)}</p>
          <p className="text-gray-400 mt-0.5">{data.loans.length}건</p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">차입 비율</p>
          <p className={`font-semibold mt-0.5 text-base ${status === 'na' ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
            {totalFund > 0 ? `${loanRatio.toFixed(1)}%` : '-'}
          </p>
          <p className="text-gray-400 mt-0.5">
            {loanMaxRatio !== null ? `한도 ${loanMaxRatio}%` : '한도 미설정'}
          </p>
        </div>
      </div>

      {loanMaxRatio !== null && totalFund > 0 && (
        <GaugeBar value={loanRatio} max={loanMaxRatio}
          color={status === 'ok' ? 'green' : status === 'warn' ? 'orange' : 'red'} />
      )}

      {data.loanByBank.length > 0 && (
        <div className="space-y-1">
          {data.loanByBank.slice(0, 3).map(({ bank, amount }) => (
            <div key={bank} className="flex justify-between text-xs text-gray-500 dark:text-slate-300">
              <span>{bank}</span><span>{fmtKRW(amount)}</span>
            </div>
          ))}
        </div>
      )}

      {data.totalLoan === 0 && (
        <p className="text-xs text-green-600 dark:text-green-400">차입금 없음</p>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-xs mx-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">차입금 한도 설정</h3>
            <div>
              <label className="text-xs font-medium text-gray-500">총자산 대비 최대 차입 비율 (%)</label>
              <input type="number" min="0" max="100" value={val}
                onChange={e => setVal(e.target.value)}
                placeholder="예: 30"
                className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                           bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditing(false)}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100">취소</button>
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 운용자금 집중도 카드 ──────────────────────────────────────────────────
function InvestConcentrationCard({ data, onNavigate }: { data: PolicyRealData; onNavigate?: () => void }) {
  const LIMIT_PCT = 30
  // 은행 기관만 집계 (investByBank는 이미 은행만 포함)
  const total = data.investByBank.reduce((s, b) => s + b.amount, 0)
  const over = data.investByBank.filter(b => total > 0 && (b.amount / total) * 100 > LIMIT_PCT)

  const status: 'ok' | 'warn' | 'over' | 'na' =
    total === 0 ? 'na'
    : over.length > 0 ? 'over'
    : data.investByBank.some(b => total > 0 && (b.amount / total) * 100 > LIMIT_PCT * 0.9) ? 'warn'
    : 'ok'

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800 dark:text-white">📊 운용자금 집중도</span>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">은행 운용자금</p>
          <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{fmtKRW(total)}</p>
          <p className="text-gray-400 mt-0.5">{data.investByBank.length}개 은행</p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2">
          <p className="text-gray-400">집중도 한도</p>
          <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{LIMIT_PCT}% 이내</p>
          <p className="text-gray-400 mt-0.5">기관별 규정 §9</p>
        </div>
      </div>

      {data.investByBank.length > 0 && (
        <div className="space-y-2">
          {data.investByBank.slice(0, 5).map(({ bank, amount }) => {
            const pct = total > 0 ? (amount / total) * 100 : 0
            const isOver = pct > LIMIT_PCT
            return (
              <div key={bank}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className={`${isOver ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-slate-300'}`}>
                    {bank}{isOver && ' ⚠'}
                  </span>
                  <span className={`${isOver ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isOver ? 'bg-red-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.min(pct / LIMIT_PCT * 100, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {onNavigate && (
        <button onClick={onNavigate} className="text-[10px] text-blue-500 hover:text-blue-700 dark:text-blue-400 w-full text-right">
          기관한도 관리 →
        </button>
      )}
      {total === 0 && (
        <p className="text-xs text-gray-400">운용자금 없음</p>
      )}
    </div>
  )
}

// ── 전체 법인 요약 행 ─────────────────────────────────────────────────────
function AllCompanySummary({
  dataMap, paramsMap, companies,
}: {
  dataMap: Record<Company, PolicyRealData>
  paramsMap: Record<Company, PolicyParamReader>
  companies: Company[]
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
          {companies.length === 3 ? '3사' : `${companies.length}개 법인`} 정책 현황 요약
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 text-gray-500 dark:text-slate-300">
              <th className="px-4 py-2 text-left font-medium">항목</th>
              {companies.map(c => (
                <th key={c} className="px-4 py-2 text-right font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {/* 운전자금 */}
            <tr>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-300">💧 운전자금(원화)</td>
              {companies.map(c => {
                const d = dataMap[c]; const p = paramsMap[c]
                const min = (p.get('liquidity_fixed_cost_monthly') ?? 0) * (p.get('liquidity_min_months') ?? 2)
                const ok = min === 0 ? null : d.operatingCash >= min
                return (
                  <td key={c} className="px-4 py-2.5 text-right">
                    <span className="font-medium text-gray-800 dark:text-white">{fmtKRW(d.operatingCash)}</span>
                    {ok !== null && (
                      <span className={`ml-1.5 ${ok ? 'text-green-500' : 'text-red-500'}`}>
                        {ok ? '✓' : '✕'}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
            {/* 외화 비중 */}
            <tr>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-300">💱 외화 비중</td>
              {companies.map(c => {
                const d = dataMap[c]; const p = paramsMap[c]
                const total = d.operatingCashWithFx
                const ratio = total > 0 ? (d.fxKrw / total) * 100 : 0
                const tMin = p.get('fx_target_min'); const tMax = p.get('fx_target_max')
                const inBand = tMin !== null && tMax !== null
                  ? ratio >= tMin && ratio <= tMax : null
                return (
                  <td key={c} className="px-4 py-2.5 text-right">
                    <span className="font-medium text-gray-800 dark:text-white">{ratio.toFixed(1)}%</span>
                    {inBand !== null && (
                      <span className={`ml-1.5 ${inBand ? 'text-green-500' : 'text-red-500'}`}>
                        {inBand ? '✓' : '✕'}
                      </span>
                    )}
                    {tMin !== null && <span className="text-gray-400 ml-1">({tMin}~{tMax}%)</span>}
                  </td>
                )
              })}
            </tr>
            {/* 운용자금 */}
            <tr>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-300">📊 운용자금(가용)</td>
              {companies.map(c => (
                <td key={c} className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-white">
                  {fmtKRW(dataMap[c].investAvail)}
                </td>
              ))}
            </tr>
            {/* 차입금 */}
            <tr>
              <td className="px-4 py-2.5 text-gray-500 dark:text-slate-300">🏦 차입금</td>
              {companies.map(c => {
                const d = dataMap[c]; const p = paramsMap[c]
                const tf = p.get('fx_total_fund') ?? d.totalFundEstimate
                const ratio = tf > 0 ? (d.totalLoan / tf) * 100 : 0
                const maxR = p.get('loan_max_total_ratio')
                const ok = maxR !== null ? ratio <= maxR : null
                return (
                  <td key={c} className="px-4 py-2.5 text-right">
                    <span className="font-medium text-gray-800 dark:text-white">{fmtKRW(d.totalLoan)}</span>
                    {ok !== null && (
                      <span className={`ml-1.5 ${ok ? 'text-green-500' : 'text-red-500'}`}>
                        {ok ? '✓' : '✕'}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 의결사항 관련 정책 지표 패널 (인라인) ────────────────────────────────
function DecisionPolicyPanel({
  decision, params, data,
}: { decision: PolicyDecision; params: PolicyParamReader; data: PolicyRealData }) {
  const title = decision.title.toLowerCase()
  const isFx       = /fx|외화|환율|헤지|헷지|band/.test(title)
  const isLiquidity = /유동성|현금|버킷|cash/.test(title)
  const isFvpl     = /fvpl|채권|duration|금리/.test(title)
  const isLoan     = /차입|대출|loan/.test(title)

  const rows: { label: string; value: string; sub?: string }[] = []

  if (isFx) {
    const tMin = params.get('fx_target_min'); const tMax = params.get('fx_target_max')
    const total = data.operatingCashWithFx
    const ratio = total > 0 ? (data.fxKrw / total) * 100 : 0
    rows.push(
      { label: 'Target Band', value: tMin !== null && tMax !== null ? `${tMin}% ~ ${tMax}%` : '미설정' },
      { label: '현재 외화비중', value: `${ratio.toFixed(1)}%`, sub: fmtKRW(data.fxKrw) },
    )
  }

  if (isLiquidity) {
    const fc = params.get('liquidity_fixed_cost_monthly') ?? 0
    const mm = params.get('liquidity_min_months') ?? 2
    rows.push(
      { label: '최소 유동성 한도', value: fc > 0 ? fmtKRW(fc * mm) : '미설정', sub: fc > 0 ? `월 ${fmtKRW(fc)} × ${mm}개월` : '' },
      { label: '현재 원화 현금성', value: fmtKRW(data.operatingCash) },
    )
  }

  if (isFvpl) {
    rows.push(
      { label: '국채 보유 (가용)', value: fmtKRW(data.bondAvail) },
      { label: '국채 건수', value: `${data.bonds.length}건`, sub: 'InvestPage FVPL 탭 참조' },
    )
  }

  if (isLoan) {
    const maxR = params.get('loan_max_total_ratio')
    rows.push(
      { label: '총 차입금', value: fmtKRW(data.totalLoan), sub: `${data.loans.length}건` },
      { label: '차입한도', value: maxR !== null ? `${maxR}%` : '미설정' },
    )
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-lg p-3">
      <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">📊 관련 정책 지표</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((r, i) => (
          <div key={i}>
            <p className="text-xs text-gray-400 dark:text-gray-500">{r.label}</p>
            <p className="text-xs font-medium text-gray-800 dark:text-white">{r.value}</p>
            {r.sub && <p className="text-xs text-gray-400">{r.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 모바일 요약 카드 그리드 (C안) ─────────────────────────────────────────
interface MobileSummaryCard {
  key: PolicyTab
  icon: string
  title: string
  value: string
  sub: string
  status: 'ok' | 'warn' | 'over' | 'na'
}

function getMobileCards(
  policyTab: PolicyTab,
  selectedCompany: Company | null,
  dataMap: Record<Company, PolicyRealData>,
  paramsReadMap: Record<Company, PolicyParamReader>,
  decisions: PolicyDecision[],
): MobileSummaryCard[] {
  const d = selectedCompany ? (dataMap[selectedCompany] ?? null) : null
  const p = selectedCompany ? (paramsReadMap[selectedCompany] ?? null) : null

  // 회의·의결
  const pendingCount = decisions.filter(dec =>
    (!selectedCompany || dec.company === selectedCompany) && dec.status !== 'completed'
  ).length

  // FX
  const fxTotal = d?.operatingCashWithFx ?? 0
  const fxRatio = fxTotal > 0 ? ((d?.fxKrw ?? 0) / fxTotal) * 100 : 0
  const fxMin = p?.get('fx_target_min') ?? null
  const fxMax = p?.get('fx_target_max') ?? null
  const fxStatus: MobileSummaryCard['status'] =
    !d ? 'na' : fxMin === null ? 'na'
    : fxRatio >= fxMin && fxRatio <= (fxMax ?? 999) ? 'ok'
    : fxRatio <= fxMin * 0.9 || fxRatio >= (fxMax ?? 999) * 1.1 ? 'over'
    : 'warn'

  // FVPL
  const bonds = d?.bonds.filter(b => b.product === '국채') ?? []
  const bondTotal = bonds.reduce((s, b) => s + (b.bondQty && b.bondPrice ? b.bondQty * (b.bondPrice / 10) : b.amount), 0)

  // 기관한도
  const invTotal = d?.investByBank.reduce((s, b) => s + b.amount, 0) ?? 0
  const maxConc = d && invTotal > 0
    ? Math.max(...d.investByBank.map(b => (b.amount / invTotal) * 100), 0)
    : 0
  const bankStatus: MobileSummaryCard['status'] =
    !d || invTotal === 0 ? 'na'
    : maxConc > 30 ? 'over'
    : maxConc > 27 ? 'warn'
    : 'ok'

  // 차입금
  const tf = (p?.get('fx_total_fund') ?? null) || (d?.totalFundEstimate ?? 0)
  const loanRatio = tf > 0 ? ((d?.totalLoan ?? 0) / tf) * 100 : 0
  const loanMax = p?.get('loan_max_total_ratio') ?? null
  const loanStatus: MobileSummaryCard['status'] =
    !d ? 'na' : loanMax === null ? 'na'
    : loanRatio <= loanMax ? 'ok'
    : loanRatio <= loanMax * 1.1 ? 'warn'
    : 'over'

  void policyTab // suppress unused warning

  return [
    {
      key: 'decisions',
      icon: '📋',
      title: '회의·의결',
      value: `${pendingCount}건 대기`,
      sub: `전체 ${decisions.filter(dec => !selectedCompany || dec.company === selectedCompany).length}건`,
      status: pendingCount > 5 ? 'warn' : 'ok',
    },
    {
      key: 'fx',
      icon: '💱',
      title: 'FX 정책',
      value: d ? `${fxRatio.toFixed(1)}%` : '-',
      sub: fxMin !== null ? `목표 ${fxMin}~${fxMax}%` : '목표 미설정',
      status: fxStatus,
    },
    {
      key: 'fvpl',
      icon: '📈',
      title: '변동성 리스크',
      value: bondTotal > 0 ? fmtKRW(bondTotal) : '-',
      sub: `국채 ${bonds.length}건`,
      status: 'na',
    },
    {
      key: 'banks',
      icon: '🏦',
      title: '기관한도',
      value: maxConc > 0 ? `최대 ${maxConc.toFixed(0)}%` : '-',
      sub: '집중도 30% 한도',
      status: bankStatus,
    },
    {
      key: 'forecast',
      icon: '📅',
      title: '주간예측',
      value: '12주 포캐스트',
      sub: selectedCompany ? selectedCompany : '법인 선택 필요',
      status: 'na',
    },
    {
      key: 'plan_c',
      icon: '📊',
      title: '만기래더링',
      value: d ? `${(d.investments.filter(i => i.active).length + d.loans.filter(l => l.active).length)}건` : '-',
      sub: `차입 ${loanRatio.toFixed(1)}% (한도 ${loanMax ?? '-'}%)`,
      status: loanStatus,
    },
  ]
}

function MobileStatusDot({ status }: { status: MobileSummaryCard['status'] }) {
  if (status === 'na') return null
  const cls = status === 'ok' ? 'bg-green-400' : status === 'warn' ? 'bg-yellow-400' : 'bg-red-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} shrink-0`} />
}

// ── 메인 PolicyPage ────────────────────────────────────────────────────────
const EMPTY_MEETING  = { title: '', meeting_type: '정책회의' as '정책회의' | '운영회의', held_at: '' }
const EMPTY_DECISION = {
  company: '셀바스에이아이' as Company,
  title: '', decision: '', owner: '', due_date: '', status: 'pending' as DecisionStatus,
}

export default function PolicyPage() {
  const { user, setCurrentCompany, currentCompany, hasCompany } = useAuth()
  const { names: companyNames } = useCompanies()
  const isMaster  = user?.role === 'master'
  const userLabel = user?.label ?? '알 수 없음'

  // ── 모바일 감지 ──────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // 이 계정이 접근 가능한 법인만 (master/admin은 companies 미설정 시 전체)
  const accessibleCompanies = useMemo(
    () => companyNames.filter(c => hasCompany(c)),
    [companyNames, hasCompany],
  )
  const canSeeAll = accessibleCompanies.length > 1

  // ── 회의·의결 훅 ──────────────────────────────────────────────────────
  const meetings = usePolicyMeetings()
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const activeMeetingId = selectedMeetingId ?? meetings.data[0]?.id ?? null
  const activeMeeting   = meetings.data.find(m => m.id === activeMeetingId)

  const decisions   = usePolicyDecisions(activeMeetingId)
  const decisionIds = useMemo(() => decisions.data.map(d => d.id), [decisions.data])
  const threads     = usePolicyThreads(decisionIds)

  // ── 정책 유형 탭 + 법인 탭 ────────────────────────────────────────────
  const [policyTab, setPolicyTab]   = useState<PolicyTab>('decisions')
  // 단일 법인 계정은 '전체' 없이 해당 법인으로 고정
  const [companyTab, setCompanyTab] = useState<Company | 'all'>('all')

  // 접근 가능한 법인이 1개뿐이면 해당 법인으로 자동 고정
  useEffect(() => {
    if (accessibleCompanies.length === 1) {
      setCompanyTab(accessibleCompanies[0])
    }
  }, [accessibleCompanies])

  // 세부 정책 탭: 법인 자동 연동 (currentCompany 우선 사용)
  const isDetailTab = (tab: PolicyTab) => tab !== 'decisions'

  function handlePolicyTab(tab: PolicyTab) {
    setPolicyTab(tab)
    if (isDetailTab(tab)) {
      // 세부 탭 전환 시 currentCompany로 자동 설정
      const target = (companyTab !== 'all' ? companyTab : currentCompany) as Company
      if (target) { setCompanyTab(target); setCurrentCompany(target) }
    }
  }

  function handleCompanyTab(company: Company | 'all') {
    // 접근 권한 없는 법인 선택 차단
    if (company !== 'all' && !hasCompany(company)) return
    setCompanyTab(company)
    if (policyTab !== 'decisions' && company !== 'all') {
      setCurrentCompany(company as Company)
    }
  }

  // ── 접근 가능 법인 전체 실데이터 + 정책 파라미터 (동적 법인 지원) ───────
  const dataMap      = usePolicyDashboards(accessibleCompanies)
  const paramsReadMap = usePolicyParamsReadMap(accessibleCompanies)

  // 선택된 단일 법인의 편집 가능한 파라미터 (set 필요 — FVPL Duration 등)
  const selectedCompany = companyTab !== 'all' ? companyTab : null
  const selectedParams  = usePolicyParams(selectedCompany)
  const selectedData    = companyTab !== 'all' ? (dataMap[companyTab] ?? null) : null

  // FVPL: 선택된 법인의 국채 최신 1건
  const fvplBonds = useMemo(() =>
    selectedData ? getLatestBonds(selectedData.bonds) : [],
  [selectedData])

  // ── 의결사항 필터 ─────────────────────────────────────────────────────
  const displayDecisions = useMemo(() => {
    if (companyTab === 'all') return decisions.data
    return decisions.data.filter(d => d.company === companyTab)
  }, [decisions.data, companyTab])

  // ── UI 상태 ──────────────────────────────────────────────────────────
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [memoText, setMemoText]         = useState<Record<string, string>>({})
  const [updatingId, setUpdatingId]     = useState<string | null>(null)
  const [showMeetingForm, setShowMeetingForm]   = useState(false)
  const [meetingForm, setMeetingForm]   = useState(EMPTY_MEETING)
  const [meetingErr, setMeetingErr]     = useState<string | null>(null)
  const [showDecisionForm, setShowDecisionForm] = useState(false)
  const [decisionForm, setDecisionForm] = useState(EMPTY_DECISION)
  const [decisionErr, setDecisionErr]   = useState<string | null>(null)
  // 의결사항 수정
  const [editDecisionId, setEditDecisionId]     = useState<string | null>(null)
  const [editDecisionForm, setEditDecisionForm] = useState(EMPTY_DECISION)
  const [editDecisionErr, setEditDecisionErr]   = useState<string | null>(null)
  // 회의 수정
  const [editMeetingId, setEditMeetingId]     = useState<string | null>(null)
  const [editMeetingForm, setEditMeetingForm] = useState(EMPTY_MEETING)
  const [editMeetingErr, setEditMeetingErr]   = useState<string | null>(null)

  function openEditMeeting() {
    const m = meetings.data.find(m => m.id === activeMeetingId)
    if (!m) return
    setEditMeetingId(m.id)
    setEditMeetingForm({ title: m.title, meeting_type: m.meeting_type, held_at: m.held_at })
    setEditMeetingErr(null)
  }

  async function handleUpdateMeeting() {
    if (!editMeetingId) return
    if (!editMeetingForm.title || !editMeetingForm.held_at) { setEditMeetingErr('제목과 날짜를 입력하세요.'); return }
    setEditMeetingErr(null)
    const err = await meetings.updateMeeting(editMeetingId, editMeetingForm)
    if (err) { setEditMeetingErr(err); return }
    setEditMeetingId(null)
  }

  async function handleDeleteMeeting() {
    if (!activeMeetingId) return
    const m = meetings.data.find(m => m.id === activeMeetingId)
    if (!confirm(`"${m?.title}" 회의를 삭제하시겠습니까?\n관련 의결사항도 모두 삭제됩니다.`)) return
    await meetings.removeMeeting(activeMeetingId)
    setSelectedMeetingId(null)
  }

  async function handleAddMeeting() {
    if (!meetingForm.title || !meetingForm.held_at) { setMeetingErr('제목과 날짜를 입력하세요.'); return }
    setMeetingErr(null)
    const err = await meetings.addMeeting({ ...meetingForm, created_by: userLabel })
    if (err) setMeetingErr(err)
    else { setShowMeetingForm(false); setMeetingForm(EMPTY_MEETING) }
  }

  async function handleAddDecision() {
    if (!activeMeetingId) return
    if (!decisionForm.title || !decisionForm.decision) { setDecisionErr('안건명과 결정내용을 입력하세요.'); return }
    setDecisionErr(null)
    const err = await decisions.addDecision({ ...decisionForm, meeting_id: activeMeetingId })
    if (err) setDecisionErr(err)
    else { setShowDecisionForm(false); setDecisionForm(EMPTY_DECISION) }
  }

  async function handleStatusChange(d: PolicyDecision, status: DecisionStatus) {
    setUpdatingId(d.id)
    await decisions.updateStatus(d.id, status)
    setUpdatingId(null)
  }

  async function handleAddMemo(decisionId: string, company: Company) {
    const text = memoText[decisionId]?.trim()
    if (!text) return
    await threads.addMemo(decisionId, text, userLabel, company)
    setMemoText(prev => ({ ...prev, [decisionId]: '' }))
  }

  // ── 모바일 요약 카드 데이터 ────────────────────────────────────────────
  const mobileCards = useMemo(() =>
    getMobileCards(policyTab, selectedCompany as Company | null, dataMap, paramsReadMap, decisions.data),
    [policyTab, selectedCompany, dataMap, paramsReadMap, decisions.data],
  )

  function handleMobileCardTap(key: PolicyTab) {
    handlePolicyTab(key)
    setMobileDetailOpen(true)
  }

  function handleMobileBack() {
    setMobileDetailOpen(false)
  }

  // ── 모바일 레이아웃 ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="p-4 space-y-4">

        {/* 모바일 헤더 */}
        <div className="flex items-center gap-3">
          {mobileDetailOpen && (
            <button onClick={handleMobileBack}
              className="p-2 -ml-1 text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white">
              ← 뒤로
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {mobileDetailOpen
                ? (mobileCards.find(c => c.key === policyTab)?.icon ?? '') + ' ' +
                  (mobileCards.find(c => c.key === policyTab)?.title ?? '자금정책')
                : '자금정책 관리'}
            </h1>
          </div>
          {isMaster && !mobileDetailOpen && (
            <button onClick={() => setShowMeetingForm(true)}
              className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
              + 새 회의
            </button>
          )}
        </div>

        {/* 법인 선택 칩 */}
        <div className="flex gap-2 flex-wrap">
          {(canSeeAll ? (['all', ...accessibleCompanies] as const) : accessibleCompanies).map(c => (
            <button key={c} onClick={() => handleCompanyTab(c as Company | 'all')}
              className={`text-sm px-3 py-1 rounded-full transition-colors ${
                companyTab === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-100'
              }`}>
              {c === 'all' ? '전체' : c}
            </button>
          ))}
        </div>

        {/* 드릴다운 상세 뷰 */}
        {mobileDetailOpen ? (
          <div className="space-y-4">
            {/* 세부 탭에서 법인 선택 필요 안내 */}
            {policyTab !== 'decisions' && companyTab === 'all' && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-center">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">위 칩에서 법인을 선택하세요.</p>
              </div>
            )}

            {/* FX 정책 */}
            {policyTab === 'fx' && companyTab !== 'all' && selectedParams && (
              <FxPolicyTab company={companyTab as Company} />
            )}

            {/* 변동성 리스크 */}
            {policyTab === 'fvpl' && companyTab !== 'all' && selectedParams && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                <FvplRiskTab
                  bonds={fvplBonds}
                  params={selectedParams}
                  isMaster={isMaster}
                  userLabel={userLabel}
                />
              </div>
            )}

            {/* 기관한도 */}
            {policyTab === 'banks' && companyTab !== 'all' && selectedData && (
              <BankLimitsTab
                company={companyTab as Company}
                investments={selectedData.investments}
                isMaster={isMaster}
                userLabel={userLabel}
              />
            )}

            {/* 주간예측 */}
            {policyTab === 'forecast' && companyTab !== 'all' && selectedData && (
              <CashflowForecastTab
                company={companyTab as Company}
                openingBalance={selectedData.operatingCash}
                isMaster={isMaster}
                userLabel={userLabel}
              />
            )}

            {/* 만기래더링 */}
            {policyTab === 'plan_c' && companyTab !== 'all' && selectedData && (
              <PolicyCTab
                investments={selectedData.investments}
                loans={selectedData.loans}
                isMaster={isMaster}
              />
            )}

            {/* 회의·의결 */}
            {policyTab === 'decisions' && (
              <div className="space-y-4">
                {/* 정책 현황 카드 */}
                {companyTab === 'all' ? (
                  <AllCompanySummary dataMap={dataMap} paramsMap={paramsReadMap} companies={accessibleCompanies} />
                ) : selectedData && selectedParams && (
                  <div className="grid grid-cols-2 gap-3">
                    <LiquidityCard data={selectedData} params={selectedParams} isMaster={isMaster} userLabel={userLabel} />
                    <FxStatusCard data={selectedData} params={selectedParams}
                      onNavigate={() => { setPolicyTab('fx'); setCompanyTab(companyTab as Company) }} />
                    <LoanStatusCard data={selectedData} params={selectedParams} isMaster={false} userLabel={userLabel} />
                    <InvestConcentrationCard data={selectedData}
                      onNavigate={() => { setPolicyTab('banks'); setCompanyTab(companyTab as Company) }} />
                  </div>
                )}

                {/* 회의 선택 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={activeMeetingId ?? ''}
                    onChange={e => setSelectedMeetingId(e.target.value || null)}
                    className="flex-1 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                    {meetings.data.length === 0 && <option value="">— 회의 없음 —</option>}
                    {meetings.data.map(m => (
                      <option key={m.id} value={m.id}>{m.title} ({m.held_at})</option>
                    ))}
                  </select>
                  {isMaster && activeMeetingId && (
                    <button onClick={() => setShowDecisionForm(true)}
                      className="text-sm px-3 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-100 rounded-lg">
                      + 안건
                    </button>
                  )}
                </div>

                {meetings.error && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚠️ 테이블 미준비</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Supabase에서 policy SQL 실행 후 새로고침</p>
                  </div>
                )}

                {/* 의결사항 목록 */}
                <div className="space-y-3">
                  {displayDecisions.map(d => {
                    const thread = threads.threadOf(d.id)
                    const isThreadOpen = openThreadId === d.id
                    const sm = STATUS_META[d.status]
                    const dday = d.due_date
                      ? Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000)
                      : null
                    const cardData = dataMap[d.company]
                    const cardParams = paramsReadMap[d.company]
                    return (
                      <div key={d.id}
                        className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                        <div className="p-4 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${companyTag(d.company)}`}>{d.company}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span>
                            {dday !== null && (
                              <span className={`text-xs ${dday < 0 ? 'text-red-500' : dday <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                                {dday < 0 ? `D+${Math.abs(dday)}` : dday === 0 ? 'D-day' : `D-${dday}`}
                              </span>
                            )}
                            {isMaster && (
                              <select value={d.status}
                                onChange={e => handleStatusChange(d, e.target.value as DecisionStatus)}
                                className="ml-auto text-xs border border-gray-200 dark:border-slate-600 rounded px-1.5 py-0.5
                                           bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-100">
                                <option value="pending">대기</option>
                                <option value="in_progress">진행중</option>
                                <option value="completed">완료</option>
                              </select>
                            )}
                          </div>
                          <p className="font-semibold text-gray-900 dark:text-white text-sm">{d.title}</p>
                          <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                            <p className="text-sm text-gray-700 dark:text-slate-100 leading-relaxed">{d.decision}</p>
                          </div>
                          {cardData && cardParams && (
                            <DecisionPolicyPanel decision={d} params={cardParams} data={cardData} />
                          )}
                          {(d.owner || d.due_date) && (
                            <div className="flex gap-4 text-xs text-gray-400">
                              {d.owner && <span>담당: {d.owner}</span>}
                              {d.due_date && <span>기한: {d.due_date}</span>}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setOpenThreadId(isThreadOpen ? null : d.id)}
                          className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-slate-700/30
                                     border-t border-gray-100 dark:border-slate-700 text-xs text-gray-500 dark:text-slate-300">
                          <span>💬 후속조치 {thread.length > 0 ? `(${thread.length})` : ''}</span>
                          <span>{isThreadOpen ? '▲' : '▼'}</span>
                        </button>
                        {isThreadOpen && (
                          <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-2">
                            {thread.map(c => (
                              <div key={c.id} className="flex gap-2 items-start">
                                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                                  <span className="text-xs text-blue-700 dark:text-blue-300">{c.user_label.slice(0,1)}</span>
                                </div>
                                <div className="flex-1">
                                  <span className="text-xs font-medium text-gray-700 dark:text-slate-100">{c.user_label}</span>
                                  <span className="text-xs text-gray-400 ml-2">{c.created_at.slice(0,10)}</span>
                                  <p className="text-sm text-gray-700 dark:text-slate-100 mt-0.5">{c.body}</p>
                                </div>
                              </div>
                            ))}
                            <div className="flex gap-2 mt-2">
                              <input
                                value={memoText[d.id] ?? ''}
                                onChange={e => setMemoText(prev => ({ ...prev, [d.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddMemo(d.id, d.company) }}}
                                placeholder="후속조치 입력 (Enter 등록)"
                                className="flex-1 text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5
                                           bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              <button onClick={() => handleAddMemo(d.id, d.company)}
                                className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">등록</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {displayDecisions.length === 0 && meetings.data.length > 0 && (
                    <p className="text-center py-8 text-sm text-gray-400">해당 법인의 의결사항이 없습니다.</p>
                  )}
                  {meetings.data.length === 0 && !meetings.error && (
                    <p className="text-center py-8 text-sm text-gray-400">등록된 회의가 없습니다.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 요약 카드 그리드 2×3 */
          <div className="grid grid-cols-2 gap-3">
            {mobileCards.map(card => (
              <button key={card.key} onClick={() => handleMobileCardTap(card.key)}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700
                           p-4 text-left shadow-sm active:scale-95 transition-transform">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{card.icon}</span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <MobileStatusDot status={card.status} />
                    <span className="text-gray-300 dark:text-slate-600 text-xs">›</span>
                  </div>
                </div>
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-1">{card.title}</p>
                <p className="text-base font-bold text-gray-900 dark:text-white leading-tight">{card.value}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{card.sub}</p>
              </button>
            ))}
          </div>
        )}

        {/* 모달들 (모바일에서도 필요) */}
        {showMeetingForm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
            <div className="bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl p-6 w-full">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">새 회의 등록</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">회의명</label>
                  <input value={meetingForm.title}
                    onChange={e => setMeetingForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="예: 2026년 2차 정책회의"
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-slate-300">유형</label>
                    <select value={meetingForm.meeting_type}
                      onChange={e => setMeetingForm(p => ({ ...p, meeting_type: e.target.value as '정책회의' | '운영회의' }))}
                      className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                      <option value="정책회의">정책회의</option>
                      <option value="운영회의">운영회의</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-slate-300">개최일</label>
                    <input type="date" value={meetingForm.held_at}
                      onChange={e => setMeetingForm(p => ({ ...p, held_at: e.target.value }))}
                      className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                  </div>
                </div>
                {meetingErr && <p className="text-xs text-red-500">{meetingErr}</p>}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setShowMeetingForm(false); setMeetingErr(null) }}
                  className="flex-1 py-3 text-sm border border-gray-200 dark:border-slate-600 rounded-xl text-gray-600 dark:text-slate-100">취소</button>
                <button onClick={handleAddMeeting}
                  className="flex-1 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium">등록</button>
              </div>
            </div>
          </div>
        )}

        {showDecisionForm && activeMeetingId && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
            <div className="bg-white dark:bg-slate-800 rounded-t-2xl shadow-2xl p-6 w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">안건 추가</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-300">법인</label>
                  <select value={decisionForm.company}
                    onChange={e => setDecisionForm(f => ({ ...f, company: e.target.value as Company }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    {accessibleCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-300">안건명 *</label>
                  <input type="text" value={decisionForm.title}
                    onChange={e => setDecisionForm(f => ({ ...f, title: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-slate-300">결정내용 *</label>
                  <textarea rows={3} value={decisionForm.decision}
                    onChange={e => setDecisionForm(f => ({ ...f, decision: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 dark:text-slate-300">담당자</label>
                    <input type="text" value={decisionForm.owner}
                      onChange={e => setDecisionForm(f => ({ ...f, owner: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 dark:text-slate-300">기한</label>
                    <input type="date" value={decisionForm.due_date}
                      onChange={e => setDecisionForm(f => ({ ...f, due_date: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100" />
                  </div>
                </div>
                {decisionErr && <p className="text-xs text-red-500">{decisionErr}</p>}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setShowDecisionForm(false); setDecisionErr(null) }}
                  className="flex-1 py-3 text-sm border border-gray-200 dark:border-slate-600 rounded-xl text-gray-600 dark:text-slate-100">취소</button>
                <button onClick={handleAddDecision}
                  className="flex-1 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium">등록</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">자금정책 관리</h1>
          <p className="text-xs text-gray-500 dark:text-slate-300 mt-0.5">
            회사별 정책 현황 · FX 정책 · 변동성 리스크 · 위원회 의결사항
          </p>
        </div>
        {isMaster && policyTab === 'decisions' && (
          <button onClick={() => setShowMeetingForm(true)}
            className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            + 새 회의
          </button>
        )}
      </div>

      {/* ── 정책 유형 탭 ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {([
          { key: 'decisions', label: '📋 회의·의결' },
          { key: 'fx',        label: '💱 FX 정책' },
          { key: 'fvpl',      label: '📈 변동성 리스크' },
          { key: 'banks',    label: '🏦 기관한도' },
          { key: 'forecast', label: '📅 주간예측' },
          { key: 'plan_c',   label: '📊 만기래더링' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => handlePolicyTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              policyTab === t.key
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 법인 탭 (세부 탭에서는 '전체' 숨김, 단일 법인 계정은 탭 미표시) ── */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {(isDetailTab(policyTab)
          ? accessibleCompanies
          : (canSeeAll ? (['all', ...accessibleCompanies] as const) : accessibleCompanies)
        ).map(c => (
          <button key={c} onClick={() => handleCompanyTab(c as Company | 'all')}
            className={`text-sm px-3 py-1 rounded-full transition-colors ${
              companyTab === c
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-100 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}>
            {c === 'all' ? '전체' : c}
            {c !== 'all' && policyTab === 'decisions' && (
              <span className="ml-1 text-xs opacity-70">
                ({decisions.data.filter(d => d.company === c).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── FX 정책 탭 ──────────────────────────────────────────────── */}
      {policyTab === 'fx' && (
        companyTab === 'all' ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">FX 정책 분석은 법인별로 적용됩니다. 위 탭에서 특정 법인을 선택하세요.</p>
          </div>
        ) : selectedParams && (
          <FxPolicyTab company={companyTab as Company} />
        )
      )}

      {/* ── 변동성 리스크 탭 ──────────────────────────────────────────── */}
      {policyTab === 'fvpl' && (
        companyTab === 'all' ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">변동성 리스크 분석은 법인별 국채 데이터를 사용합니다.</p>
          </div>
        ) : selectedParams ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <FvplRiskTab
              bonds={fvplBonds}
              params={selectedParams}
              isMaster={isMaster}
              userLabel={userLabel}
            />
          </div>
        ) : null
      )}

      {/* ── 기관한도 탭 ─────────────────────────────────────────────── */}
      {policyTab === 'banks' && (
        companyTab === 'all' ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">기관 한도 관리는 법인별로 적용됩니다.</p>
          </div>
        ) : selectedData ? (
          <BankLimitsTab
            company={companyTab as Company}
            investments={selectedData.investments}
            isMaster={isMaster}
            userLabel={userLabel}
          />
        ) : null
      )}

      {/* ── 주간예측 탭 ─────────────────────────────────────────────── */}
      {policyTab === 'forecast' && (
        companyTab === 'all' ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">12주 롤링 포캐스트는 법인별로 관리됩니다.</p>
          </div>
        ) : selectedData ? (
          <CashflowForecastTab
            company={companyTab as Company}
            openingBalance={selectedData.operatingCash}
            isMaster={isMaster}
            userLabel={userLabel}
          />
        ) : null
      )}

      {/* ── C안: 만기 래더링 + 상품 적정성 ────────────────────────────── */}
      {policyTab === 'plan_c' && (
        companyTab === 'all' ? (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 text-center">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">법인을 선택해주세요</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">만기 래더링은 법인별 운용·차입 데이터를 사용합니다.</p>
          </div>
        ) : selectedData ? (
          <PolicyCTab
            investments={selectedData.investments}
            loans={selectedData.loans}
            isMaster={isMaster}
          />
        ) : null
      )}

      {/* ── 회의·의결사항 (decisions 탭만 표시) ──────────────────────── */}
      {policyTab === 'decisions' && <>

      {/* 정책 현황 패널 */}
      {companyTab === 'all' ? (
        <AllCompanySummary dataMap={dataMap} paramsMap={paramsReadMap} companies={accessibleCompanies} />
      ) : selectedData && selectedParams && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <LiquidityCard data={selectedData} params={selectedParams} isMaster={isMaster} userLabel={userLabel} />
          <FxStatusCard  data={selectedData} params={selectedParams}
            onNavigate={() => { setPolicyTab('fx'); setCompanyTab(companyTab as Company) }} />
          <LoanStatusCard data={selectedData} params={selectedParams} isMaster={isMaster} userLabel={userLabel} />
          <InvestConcentrationCard data={selectedData}
            onNavigate={() => { setPolicyTab('banks'); setCompanyTab(companyTab as Company) }} />
        </div>
      )}

      {/* 구분선 */}
      <div className="border-t border-gray-100 dark:border-slate-700 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-100">📋 회의·의결사항</span>
            {/* 회의 선택 */}
            <select value={activeMeetingId ?? ''}
              onChange={e => setSelectedMeetingId(e.target.value || null)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              {meetings.data.length === 0 && <option value="">— 회의 없음 —</option>}
              {meetings.data.map(m => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.held_at})
                </option>
              ))}
            </select>
            {/* 선택된 회의 수정/삭제 버튼 */}
            {isMaster && activeMeetingId && (
              <div className="flex items-center gap-1">
                <button onClick={openEditMeeting}
                  title="회의 수정"
                  className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors">
                  ✏️ 수정
                </button>
                <button onClick={handleDeleteMeeting}
                  title="회의 삭제"
                  className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                  🗑️ 삭제
                </button>
              </div>
            )}
            {activeMeeting && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                activeMeeting.meeting_type === '정책회의'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
              }`}>
                {activeMeeting.meeting_type}
              </span>
            )}
          </div>
          {isMaster && activeMeetingId && (
            <button onClick={() => setShowDecisionForm(true)}
              className="text-sm px-3 py-1 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-gray-600
                         text-gray-700 dark:text-slate-100 rounded-full">
              + 안건 추가
            </button>
          )}
        </div>
      </div>

      {/* ── 에러 / 빈 상태 ───────────────────────────────────────────── */}
      {meetings.error && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-1">
            ⚠️ 데이터베이스 테이블이 준비되지 않았습니다
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Supabase에서 <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">docs/supabase_policy_tables.sql</code> 실행 후 새로고침
          </p>
          <p className="text-xs text-amber-500 mt-1 font-mono">{meetings.error}</p>
        </div>
      )}

      {!meetings.error && meetings.data.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm">등록된 회의가 없습니다.</p>
          {isMaster && <p className="text-xs mt-1">상단 "+ 새 회의" 버튼으로 추가하세요.</p>}
        </div>
      )}

      {displayDecisions.length === 0 && meetings.data.length > 0 && (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500">
          <div className="text-3xl mb-2">📄</div>
          <p className="text-sm">해당 법인의 의결사항이 없습니다.</p>
        </div>
      )}

      {/* ── 의결사항 카드 목록 ───────────────────────────────────────── */}
      <div className="space-y-3">
        {displayDecisions.map(d => {
          const thread    = threads.threadOf(d.id)
          const isThreadOpen = openThreadId === d.id
          const sm        = STATUS_META[d.status]
          const dday      = d.due_date
            ? Math.ceil((new Date(d.due_date).getTime() - Date.now()) / 86400000)
            : null
          // 해당 의결사항 법인의 실데이터 + 파라미터 (접근 불가 법인이면 undefined)
          const cardData   = dataMap[d.company]
          const cardParams = paramsReadMap[d.company]

          return (
            <div key={d.id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${companyTag(d.company)}`}>
                        {d.company}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.cls}`}>
                        {sm.label}
                      </span>
                      {dday !== null && (
                        <span className={`text-xs ${dday < 0 ? 'text-red-500' : dday <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                          {dday < 0 ? `D+${Math.abs(dday)}` : dday === 0 ? 'D-day' : `D-${dday}`}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-white text-sm">{d.title}</p>
                  </div>
                  {isMaster && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select value={d.status} disabled={updatingId === d.id}
                        onChange={e => handleStatusChange(d, e.target.value as DecisionStatus)}
                        className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1
                                   bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-100">
                        <option value="pending">대기</option>
                        <option value="in_progress">진행중</option>
                        <option value="completed">완료</option>
                      </select>
                      <button
                        onClick={() => { setEditDecisionId(d.id); setEditDecisionForm({ company: d.company, title: d.title, decision: d.decision, owner: d.owner || '', due_date: d.due_date || '', status: d.status }); setEditDecisionErr(null) }}
                        className="text-xs text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 px-1.5 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30">
                        수정
                      </button>
                      <button
                        onClick={async () => { if (!confirm('이 안건을 삭제하시겠습니까?')) return; await decisions.removeDecision(d.id) }}
                        className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400 px-1.5 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30">
                        삭제
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-2 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                  <p className="text-sm text-gray-700 dark:text-slate-100 leading-relaxed">{d.decision}</p>
                </div>

                {/* 관련 정책 지표 (키워드 매칭) — 접근 가능 법인만 */}
                {cardData && cardParams && (
                  <DecisionPolicyPanel
                    decision={d}
                    params={cardParams}
                    data={cardData}
                  />
                )}

                <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                  {d.owner && <span>담당: <span className="text-gray-600 dark:text-slate-100">{d.owner}</span></span>}
                  {d.due_date && <span>기한: <span className="text-gray-600 dark:text-slate-100">{d.due_date}</span></span>}
                  {thread.length > 0 && <span>{thread.length}개 메모</span>}
                </div>
              </div>

              {/* 후속조치 스레드 */}
              <button onClick={() => setOpenThreadId(isThreadOpen ? null : d.id)}
                className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-slate-700/30
                           border-t border-gray-100 dark:border-slate-700 text-xs text-gray-500 dark:text-slate-300
                           hover:bg-gray-100 dark:hover:bg-slate-700/60 transition-colors">
                <span>💬 후속조치 {thread.length > 0 ? `(${thread.length})` : ''}</span>
                <span>{isThreadOpen ? '▲' : '▼'}</span>
              </button>

              {isThreadOpen && (
                <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-slate-700 space-y-2">
                  {thread.length === 0 && (
                    <p className="text-xs text-gray-400 py-1">등록된 후속조치가 없습니다.</p>
                  )}
                  {thread.map(c => (
                    <div key={c.id} className="flex gap-2 items-start">
                      <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                        <span className="text-xs text-blue-700 dark:text-blue-300">{c.user_label.slice(0, 1)}</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-700 dark:text-slate-100">{c.user_label}</span>
                          <span className="text-xs text-gray-400">{c.created_at.slice(0, 10)}</span>
                          {isMaster && (
                            <button onClick={() => threads.removeMemo(c.id)}
                              className="text-xs text-gray-300 hover:text-red-500 ml-auto">✕</button>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 dark:text-slate-100 mt-0.5">{c.body}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      value={memoText[d.id] ?? ''}
                      onChange={e => setMemoText(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddMemo(d.id, d.company) } }}
                      placeholder="후속조치 입력 (Enter 등록)"
                      className="flex-1 text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5
                                 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400"
                    />
                    <button onClick={() => handleAddMemo(d.id, d.company)}
                      className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                      등록
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── 새 회의 모달 ─────────────────────────────────────────────── */}
      {/* decisions 탭 끝 */}
      </>}

      {/* ── 의결사항 수정 모달 (탭 외부) ────────────────────────────────── */}
      {editDecisionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditDecisionId(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800 dark:text-white">안건 수정</h3>
              <button onClick={() => setEditDecisionId(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">안건명 *</label>
                <input type="text" value={editDecisionForm.title}
                  onChange={e => setEditDecisionForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">결정내용 *</label>
                <textarea rows={3} value={editDecisionForm.decision}
                  onChange={e => setEditDecisionForm(f => ({ ...f, decision: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">담당자</label>
                  <input type="text" value={editDecisionForm.owner}
                    onChange={e => setEditDecisionForm(f => ({ ...f, owner: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">이행 기한</label>
                  <input type="date" value={editDecisionForm.due_date}
                    onChange={e => setEditDecisionForm(f => ({ ...f, due_date: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
            </div>
            {editDecisionErr && <p className="text-xs text-red-500">{editDecisionErr}</p>}
            <div className="flex gap-2">
              <button onClick={() => setEditDecisionId(null)}
                className="flex-1 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700">
                취소
              </button>
              <button onClick={async () => {
                if (!editDecisionForm.title || !editDecisionForm.decision) { setEditDecisionErr('안건명과 결정내용을 입력하세요.'); return }
                const err = await decisions.updateDecision(editDecisionId, {
                  title: editDecisionForm.title,
                  decision: editDecisionForm.decision,
                  owner: editDecisionForm.owner,
                  due_date: editDecisionForm.due_date || undefined,
                  status: editDecisionForm.status,
                })
                if (err) { setEditDecisionErr(err); return }
                setEditDecisionId(null)
              }}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 새 회의 모달 (탭 외부) */}
      {showMeetingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">새 회의 등록</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-slate-300">회의명</label>
                <input value={meetingForm.title}
                  onChange={e => setMeetingForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="예: 2026년 2차 정책회의"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">회의 유형</label>
                  <select value={meetingForm.meeting_type}
                    onChange={e => setMeetingForm(p => ({ ...p, meeting_type: e.target.value as '정책회의' | '운영회의' }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    <option value="정책회의">정책회의 (반기)</option>
                    <option value="운영회의">운영회의 (분기)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">개최일</label>
                  <input type="date" value={meetingForm.held_at}
                    onChange={e => setMeetingForm(p => ({ ...p, held_at: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              {meetingErr && <p className="text-xs text-red-500">{meetingErr}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setShowMeetingForm(false); setMeetingErr(null) }}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100">
                취소
              </button>
              <button onClick={handleAddMeeting}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 회의 수정 모달 ──────────────────────────────────────────────── */}
      {editMeetingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditMeetingId(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">회의 수정</h2>
              <button onClick={() => setEditMeetingId(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-slate-300">회의명</label>
                <input value={editMeetingForm.title}
                  onChange={e => setEditMeetingForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="예: 2026년 2차 정책회의"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">회의 유형</label>
                  <select value={editMeetingForm.meeting_type}
                    onChange={e => setEditMeetingForm(p => ({ ...p, meeting_type: e.target.value as '정책회의' | '운영회의' }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="정책회의">정책회의 (반기)</option>
                    <option value="운영회의">운영회의 (분기)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">개최일</label>
                  <input type="date" value={editMeetingForm.held_at}
                    onChange={e => setEditMeetingForm(p => ({ ...p, held_at: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              {editMeetingErr && <p className="text-xs text-red-500">{editMeetingErr}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditMeetingId(null)}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700">
                취소
              </button>
              <button onClick={handleUpdateMeeting}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 안건 추가 모달 ────────────────────────────────────────────── */}
      {/* ── 안건 추가 모달 (탭 외부 — 항상 렌더링 가능) ──────────────── */}
      {showDecisionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">의결사항 추가</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">법인</label>
                  <select value={decisionForm.company}
                    onChange={e => setDecisionForm(p => ({ ...p, company: e.target.value as Company }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    {accessibleCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">초기 상태</label>
                  <select value={decisionForm.status}
                    onChange={e => setDecisionForm(p => ({ ...p, status: e.target.value as DecisionStatus }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                    <option value="pending">대기</option>
                    <option value="in_progress">진행중</option>
                    <option value="completed">완료</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-slate-300">안건명</label>
                <input value={decisionForm.title}
                  onChange={e => setDecisionForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="예: FX Target Band 설정 / 유동성 버킷 확정"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-slate-300">결정내용</label>
                <textarea value={decisionForm.decision}
                  onChange={e => setDecisionForm(p => ({ ...p, decision: e.target.value }))}
                  rows={3}
                  placeholder="예: 20~25% 확정 — 초과분 월 분할환전 원칙 수립"
                  className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">담당자</label>
                  <input value={decisionForm.owner}
                    onChange={e => setDecisionForm(p => ({ ...p, owner: e.target.value }))}
                    placeholder="예: 메디아나 CFO"
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-300">기한</label>
                  <input type="date" value={decisionForm.due_date}
                    onChange={e => setDecisionForm(p => ({ ...p, due_date: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                               bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              {decisionErr && <p className="text-xs text-red-500">{decisionErr}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setShowDecisionForm(false); setDecisionErr(null) }}
                className="flex-1 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100">
                취소
              </button>
              <button onClick={handleAddDecision}
                className="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

