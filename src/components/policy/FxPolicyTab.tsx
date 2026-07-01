import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useDaily } from '../../hooks/useDaily'
import { useInvestments, getLatestInvestments, getLatestBonds } from '../../hooks/useInvestments'
import { useEquities } from '../../hooks/useEquities'
import { useFx } from '../../hooks/useFx'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { fetchFxStdDev } from '../../hooks/useGas'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { restInsert } from '../../lib/supabase'
import { generateUUID } from '../../lib/format'
import { useFxTradeHistory } from '../../hooks/useFxTradeHistory'
import type { Company, FxCode } from '../../types'

// 4개 통화 (ECOS 지원 통화만 — CNY 제외)
const FX_CURRENCIES = [
  { code: 'USD' as FxCode, name: '미국 달러',   color: '#2563EB', stdKey: 'fx_std_usd', wgtKey: 'fx_weight_usd', defaultStd: 0.082458, defaultWgt: 0.80 },
  { code: 'EUR' as FxCode, name: '유로',         color: '#7C3AED', stdKey: 'fx_std_eur', wgtKey: 'fx_weight_eur', defaultStd: 0.114437, defaultWgt: 0.18 },
  { code: 'JPY' as FxCode, name: '일본 엔',      color: '#DC2626', stdKey: 'fx_std_jpy', wgtKey: 'fx_weight_jpy', defaultStd: 0.108875, defaultWgt: 0.02 },
  { code: 'GBP' as FxCode, name: '영국 파운드', color: '#059669', stdKey: 'fx_std_gbp', wgtKey: 'fx_weight_gbp', defaultStd: 0.130257, defaultWgt: 0.00 },
]

const Z_TABLE = { 90: 1.282, 95: 1.6503, 99: 2.326 } as const
type ConfLevel = 90 | 95 | 99

function fmtAmt(v: number, code: FxCode): string {
  if (code === 'JPY') return fmtNumber(Math.round(v), 0) + '엔'
  return fmtNumber(Math.round(v), 0)
}

interface TradeModal { code: FxCode | 'total'; excessKrw: number }

export default function FxPolicyTab({ company }: { company: Company }) {
  const { user } = useAuth()
  const isMaster = user?.role === 'master'
  const daily    = useDaily()
  const invest   = useInvestments(true)
  const equities = useEquities()
  const fx       = useFx()
  const params   = usePolicyParams(company)

  // ── 정책 파라미터
  const riskPortion      = params.get('fx_risk_portion')      ?? 0.5
  const targetMin        = params.get('fx_target_min')        ?? 20
  const targetMax        = params.get('fx_target_max')        ?? 25
  const operatingProfit  = params.get('fx_operating_profit')  ?? 4_300_000_000
  const interestIncome   = params.get('fx_interest_income')   ?? 2_300_000_000
  const maxFxRatio       = params.get('fx_max_fx_ratio')      ?? 0.30
  const confidenceLevel  = Number(params.get('fx_confidence_level') ?? 95) as ConfLevel
  // 의결 확정값 — master가 🔒 확정 버튼으로 승격; null = 미의결
  const decidedLevel     = params.get('fx_confidence_level_decided') != null
    ? Number(params.get('fx_confidence_level_decided')) as ConfLevel
    : null
  const decidedDate         = params.getText('fx_conf_decided_date')    ?? null
  const decidedMeetingLabel = params.getText('fx_conf_decided_meeting') ?? null

  const currencyRows = FX_CURRENCIES.map(c => ({
    ...c,
    std: params.get(c.stdKey) ?? c.defaultStd,
    wgt: params.get(c.wgtKey) ?? c.defaultWgt,
  }))

  // ── 슬라이더·신뢰도·통화비중 로컬 상태 (계산에 사용되므로 계산 코드보다 먼저 선언)
  const [localRiskPct,   setLocalRiskPct]   = useState(riskPortion * 100)
  const [localMaxFxPct,  setLocalMaxFxPct]  = useState(maxFxRatio * 100)
  const [localConfLevel, setLocalConfLevel] = useState<ConfLevel>(confidenceLevel)
  const [localWeights,   setLocalWeights]   = useState<Record<string, number>>(() =>
    Object.fromEntries(FX_CURRENCIES.map(c => [c.code, Math.round((params.get(c.wgtKey) ?? c.defaultWgt) * 100)]))
  )

  // ── 계산
  const z              = Z_TABLE[localConfLevel] ?? 1.6503
  const weightedStdSum = currencyRows.reduce((s, r) => s + r.wgt * r.std, 0)
  const maxRateChange  = weightedStdSum * z

  // ── 가용 자금 합계 (운전자금 + 가용 운용자금 + 가용 국채 + 가용 지분/장기투자)
  const latestDaily = useMemo(() => daily.data[0] ?? null, [daily.data])
  const operatingCash = useMemo(() => latestDaily
    ? (latestDaily.krw_demand + latestDaily.krw_govt + latestDaily.krw_mmda + latestDaily.fx_krw)
    : 0, [latestDaily])
  const investAvailCash = useMemo(() => {
    const latest = getLatestInvestments(invest.data)
    return latest
      .filter(i => i.product !== '국채' && i.available === '가용')
      .reduce((s, i) => {
        if (!i.currency || i.currency === 'KRW') return s + (i.amount || 0)
        return s + fx.toKRW(i.amount || 0, i.currency as FxCode)
      }, 0)
  }, [invest.data, fx.rates]) // eslint-disable-line react-hooks/exhaustive-deps
  const bondAvailCash = useMemo(() => {
    const latestBonds = getLatestBonds(invest.data)
    return latestBonds
      .filter(b => b.available === '가용')
      .reduce((s, b) => {
        if (b.bondQty && b.bondPrice) return s + b.bondQty * b.bondPrice / 10
        return s + (b.amount || 0)
      }, 0)
  }, [invest.data])
  const equityAvailCash = useMemo(() =>
    equities.latest
      .filter(e => e.available === '가용')
      .reduce((s, e) => s + (e.total_value || 0), 0)
  , [equities.latest])
  const totalFund = operatingCash + investAvailCash + bondAvailCash + equityAvailCash

  // ── 이중 안전장치 (로컬 슬라이더 값으로 실시간 계산 — Supabase 저장 전에도 즉각 반영)
  const maxAllowedLoss  = (operatingProfit + interestIncome) * (localRiskPct / 100)
  const limitA          = maxRateChange > 0 ? maxAllowedLoss / maxRateChange : 0
  const limitB          = totalFund * (localMaxFxPct / 100)
  const effectiveLimit  = Math.min(limitA > 0 ? limitA : limitB, limitB > 0 ? limitB : limitA)
  const aWins           = limitA > 0 && limitB > 0 ? limitA <= limitB : limitA > 0
  const optimalFxRatio  = totalFund > 0 ? (effectiveLimit / totalFund) * 100 : 0

  // ── 통화별 외화 잔액 분리 계산
  // 운전자금 외화 (daily 테이블, 통화별 원화환산)
  const operatingFxNative: Record<FxCode, number> = {
    USD: latestDaily?.fx_usd ?? 0,
    EUR: latestDaily?.fx_eur ?? 0,
    JPY: latestDaily?.fx_jpy ?? 0,
    GBP: latestDaily?.fx_gbp ?? 0,
    CNY: latestDaily?.fx_cny ?? 0,
  }
  // 운용자금 외화 (investments 테이블, currency != KRW, 가용만)
  const investFxNative = useMemo(() => {
    const result: Partial<Record<FxCode, number>> = {}
    const latest = getLatestInvestments(invest.data)
    latest
      .filter(i => i.product !== '국채' && i.available === '가용' && i.currency && i.currency !== 'KRW')
      .forEach(i => {
        const code = i.currency as FxCode
        result[code] = (result[code] ?? 0) + (i.amount || 0)
      })
    return result
  }, [invest.data])

  // 통화별 합계 (운전 + 운용) — KRW 환산
  const operatingFxKrwByCode = useMemo(() =>
    Object.fromEntries(FX_CURRENCIES.map(c => [c.code, fx.toKRW(operatingFxNative[c.code] ?? 0, c.code)]))
  , [operatingFxNative, fx]) // eslint-disable-line react-hooks/exhaustive-deps
  const investFxKrwByCode = useMemo(() =>
    Object.fromEntries(FX_CURRENCIES.map(c => [c.code, fx.toKRW(investFxNative[c.code] ?? 0, c.code)]))
  , [investFxNative, fx]) // eslint-disable-line react-hooks/exhaustive-deps
  const fxKrwByCode = useMemo(() =>
    Object.fromEntries(FX_CURRENCIES.map(c => [c.code,
      (operatingFxKrwByCode[c.code] ?? 0) + (investFxKrwByCode[c.code] ?? 0)
    ])) as Record<FxCode, number>
  , [operatingFxKrwByCode, investFxKrwByCode])

  // 하위 호환: 통화별 native 합계 (운전+운용) — 테이블 표시용
  const fxBalances = useMemo(() =>
    Object.fromEntries(FX_CURRENCIES.map(c => [c.code,
      (operatingFxNative[c.code] ?? 0) + (investFxNative[c.code] ?? 0)
    ])) as Record<FxCode, number>
  , [operatingFxNative, investFxNative])

  // 현재 외화 보유 총액 = 통화별 KRW 합산 (운전 + 운용)
  const totalIndividualFxKrw = Object.values(fxKrwByCode).reduce((s, v) => s + v, 0)
  const currentFxKrw   = totalIndividualFxKrw
  const currentFxRatio = totalFund > 0 ? (currentFxKrw / totalFund) * 100 : 0
  const fxGap          = currentFxKrw - effectiveLimit  // 양수 = 초과, 음수 = 여유
  const isOverLimit    = fxGap > 0

  // ── Target Band
  const bandInRange = targetMin <= 100 && targetMax <= 100
  const clamp       = (v: number) => Math.min(Math.max(v, 0), 100)
  const currentPos  = clamp(currentFxRatio)
  const inBand      = bandInRange && currentFxRatio >= targetMin && currentFxRatio <= targetMax

  // ── 환율 마운트 시 자동 로드 (useFx는 컴포넌트별 독립 인스턴스 — Sidebar 공유 안 됨)
  useEffect(() => { void fx.fetchRates() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 슬라이더 Supabase 값과 동기화
  useEffect(() => { setLocalRiskPct(riskPortion * 100) }, [riskPortion])
  useEffect(() => { setLocalMaxFxPct(maxFxRatio * 100) }, [maxFxRatio])
  useEffect(() => { setLocalConfLevel(confidenceLevel) }, [confidenceLevel])
  // 통화 비중 — params 로드 완료 후 초기화 (최초 1회)
  useEffect(() => {
    if (params.loading) return
    setLocalWeights(Object.fromEntries(
      FX_CURRENCIES.map(c => [c.code, Math.round((params.get(c.wgtKey) ?? c.defaultWgt) * 100)])
    ))
  }, [params.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  function riskSliderStyle(): React.CSSProperties {
    const pct = ((localRiskPct - 10) / 90) * 100
    return { '--fill': `${pct}%` } as React.CSSProperties
  }
  function maxFxSliderStyle(): React.CSSProperties {
    const pct = ((localMaxFxPct - 5) / 45) * 100
    return { '--fill': `${pct}%` } as React.CSSProperties
  }

  // ── 편집 상태
  const [editingParams, setEditingParams] = useState(false)
  const [editingStd,    setEditingStd]    = useState(false)
  const [draftParams, setDraftParams]     = useState<Record<string, number>>({})
  const [draftStd,    setDraftStd]        = useState<Record<string, number>>({})
  const [saving, setSaving]               = useState(false)
  const [autoCalcState, setAutoCalcState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [autoCalcMsg,   setAutoCalcMsg]   = useState<string | null>(null)
  const [bandPreview, setBandPreview]     = useState<{ min: number; max: number; bandWidth: number } | null>(null)
  const [bandError,   setBandError]       = useState<string | null>(null)

  // ── 의결 확정 흐름
  const [decidingConf, setDecidingConf]   = useState(false)
  const [decideMeeting, setDecideMeeting] = useState('')
  const [decideSaving,  setDecideSaving]  = useState(false)

  async function handleDecideConf() {
    setDecideSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    await params.set('fx_confidence_level_decided', localConfLevel,  null,                                          user?.label ?? '')
    await params.set('fx_conf_decided_date',         null,           today,                                         user?.label ?? '')
    await params.set('fx_conf_decided_meeting',      null,           decideMeeting.trim() || '자금정책위원회',      user?.label ?? '')
    // 동시에 시뮬 값도 동기화 (의결 확정 = 공식 채택)
    await params.set('fx_confidence_level', localConfLevel, null, user?.label ?? '')
    setDecideSaving(false)
    setDecidingConf(false)
    setDecideMeeting('')
  }

  // ── 환전 발의 모달 상태
  const tradeHist = useFxTradeHistory()
  const [tradeModal,   setTradeModal]   = useState<TradeModal | null>(null)
  const [tradeAmt,     setTradeAmt]     = useState('')   // 외화 금액 (문자열)
  const [tradeDate,    setTradeDate]    = useState('')
  const [tradeMemo,    setTradeMemo]    = useState('')
  const [tradeAcqRate, setTradeAcqRate] = useState('')   // 취득 환율
  const [tradeSellRate, setTradeSellRate] = useState('') // 매도(예정) 환율
  const [tradeSaving,  setTradeSaving]  = useState(false)

  useEffect(() => {
    if (editingParams) setDraftParams({
      fx_operating_profit: operatingProfit,
      fx_interest_income:  interestIncome,
    })
  }, [editingParams]) // eslint-disable-line

  useEffect(() => {
    if (editingStd) {
      const init: Record<string, number> = {}
      currencyRows.forEach(r => { init[r.stdKey] = r.std; init[r.wgtKey] = r.wgt })
      setDraftStd(init)
    }
  }, [editingStd]) // eslint-disable-line

  async function saveParams() {
    setSaving(true)
    for (const [k, v] of Object.entries(draftParams)) await params.set(k, v, null, user?.label ?? '')
    setSaving(false); setEditingParams(false)
  }
  async function saveStd() {
    setSaving(true)
    for (const [k, v] of Object.entries(draftStd)) await params.set(k, v, null, user?.label ?? '')
    setSaving(false); setEditingStd(false)
  }

  async function handleAutoCalcStdDev() {
    setAutoCalcState('loading'); setAutoCalcMsg(null)
    try {
      const result = await fetchFxStdDev(12)
      const { stddev, period, dataCount } = result
      const entries: [string, number | null][] = [
        ['fx_std_usd', stddev.USD], ['fx_std_eur', stddev.EUR],
        ['fx_std_jpy', stddev.JPY], ['fx_std_gbp', stddev.GBP],
      ]
      for (const [key, val] of entries) {
        if (val !== null) await params.set(key, val, null, user?.label ?? '')
      }
      setAutoCalcState('done')
      setAutoCalcMsg(`✅ ${period.from.slice(0,4)}-${period.from.slice(4,6)} ~ ${period.to.slice(0,4)}-${period.to.slice(4,6)} (${dataCount}일) 갱신됨`)
    } catch (err) {
      setAutoCalcState('error')
      setAutoCalcMsg(err instanceof Error ? err.message : '오류')
    }
  }

  function previewAutoBand() {
    setBandError(null)
    if (effectiveLimit <= 0) { setBandError('적정 외화보유 한도를 계산할 수 없습니다.'); return }
    if (optimalFxRatio > 100) {
      setBandError(`적정 외화보유한도(${fmtKRW(effectiveLimit)})가 전체 자금(${fmtKRW(totalFund)})을 초과합니다. Target Band를 직접 설정하세요.`)
      return
    }
    // 상한 = 실효 외화비중 (effectiveLimit / totalFund)
    const max = Math.round(optimalFxRatio * 10) / 10
    // Band폭 = 최대환율변동폭 × 2, 최소 1%p, 최대 5%p (±변동폭 내에서 허용)
    const dynamicBandWidth = Math.min(Math.max(Math.round(maxRateChange * 2 * 1000) / 10, 1), 5)
    const min = Math.max(0, Math.round((max - dynamicBandWidth) * 10) / 10)
    setBandPreview({ min, max, bandWidth: dynamicBandWidth })
  }

  async function applyAutoBand() {
    if (!bandPreview) return
    const confirmed = window.confirm(
      `[자금정책위원회 의결 사항]\nFX Target Band 변경\n이전: ${targetMin}%~${targetMax}%\n변경: ${bandPreview.min}%~${bandPreview.max}%\n\n계속하시겠습니까?`
    )
    if (!confirmed) return
    const prevMin = targetMin, prevMax = targetMax
    await params.set('fx_target_min', bandPreview.min, null, user?.label ?? '')
    await params.set('fx_target_max', bandPreview.max, null, user?.label ?? '')
    await restInsert('issue_comments', {
      id: generateUUID(), issue_key: `policy_fx_band_${company}`,
      body: `📋 FX Target Band 변경 (${user?.label ?? ''})\n이전: ${prevMin}%~${prevMax}% → 변경: ${bandPreview.min}%~${bandPreview.max}%`,
      created_by: user?.label ?? '',
    })
    setBandPreview(null)
  }

  // 환차손익 계산 (모달 내 실시간)
  const tradeFxPnl = useMemo(() => {
    const amt  = Number(tradeAmt)
    const acq  = Number(tradeAcqRate)
    const sell = Number(tradeSellRate)
    if (!amt || !acq || !sell) return null
    return (sell - acq) * amt
  }, [tradeAmt, tradeAcqRate, tradeSellRate])

  // ── 환전 발의 제출
  function openTradeModal(code: FxCode | 'total', excessKrw: number) {
    const rate = code !== 'total' ? fx.toKRW(1, code) : 0
    const defaultAmt = code !== 'total' && rate > 0
      ? Math.ceil(excessKrw / rate).toString()
      : ''
    const today = new Date(); today.setDate(today.getDate() + 3)
    const yyyy = today.getFullYear()
    const mm   = String(today.getMonth() + 1).padStart(2, '0')
    const dd   = String(today.getDate()).padStart(2, '0')
    const currentRate = code !== 'total' ? fx.toKRW(1, code) : 0
    setTradeModal({ code, excessKrw })
    setTradeAmt(defaultAmt)
    setTradeDate(`${yyyy}-${mm}-${dd}`)
    setTradeAcqRate('')
    setTradeSellRate(currentRate > 0 ? fmtNumber(currentRate, 2) : '')
    setTradeMemo(
      code === 'total'
        ? `FX 정책 상한(${fmtKRW(effectiveLimit)}) 초과 발생. 초과분 ${fmtKRW(excessKrw)} 원화 전환 발의.`
        : `FX 정책 상한 초과 — ${code} ${fmtKRW(excessKrw)} 원화 전환 발의.`
    )
  }

  async function submitTradeProposal() {
    if (!tradeModal) return
    setTradeSaving(true)
    const amtFx    = Number(tradeAmt) || 0
    const acqRate  = Number(tradeAcqRate) || null
    const sellRate = Number(tradeSellRate) || null
    const pnl      = tradeFxPnl
    const krw      = sellRate && amtFx ? sellRate * amtFx : null
    const currency = tradeModal.code !== 'total' ? tradeModal.code : 'USD'
    try {
      const body = [
        `💱 외화 매도 발의 (${user?.label ?? ''})`,
        `법인: ${company}`,
        `통화: ${tradeModal.code === 'total' ? '복합' : tradeModal.code}`,
        tradeModal.code !== 'total' ? `외화 금액: ${tradeAmt} ${tradeModal.code}` : '',
        acqRate  ? `취득 환율: ${fmtNumber(acqRate, 2)}원` : '',
        sellRate ? `매도(예정) 환율: ${fmtNumber(sellRate, 2)}원` : '',
        pnl != null ? `예상 환차${pnl >= 0 ? '익' : '손'}: ${fmtKRW(Math.abs(pnl))}` : '',
        `원화 환산 초과분: ${fmtKRW(tradeModal.excessKrw)}`,
        `희망 집행일: ${tradeDate}`,
        `사유: ${tradeMemo}`,
      ].filter(Boolean).join('\n')
      await restInsert('issue_comments', {
        id: generateUUID(),
        issue_key: `policy_fx_trade_${company}`,
        body,
        created_by: user?.label ?? '',
      })
      // 외화매매거래 이력 기록
      await tradeHist.propose({
        company,
        trade_date: tradeDate,
        currency,
        direction: 'sell',
        amount_fx: amtFx,
        acq_rate: acqRate,
        trade_rate: sellRate,
        fx_pnl: pnl,
        amount_krw: krw,
        memo: tradeMemo,
        created_by: user?.label ?? '',
      })
      setTradeModal(null)
    } finally {
      setTradeSaving(false)
    }
  }

  // ── 통화별 상한/현재 비교 행
  const compareRows = currencyRows.map(r => {
    const krwVal    = fxKrwByCode[r.code] ?? 0
    const ceilKrw   = effectiveLimit * r.wgt   // 정책 상한 (이 통화의 한도)
    const excess    = krwVal - ceilKrw          // 양수 = 초과, 음수 = 여유
    return { ...r, krwVal, ceilKrw, excess }
  })

  const card = 'bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5'

  return (
    <div className="space-y-5">

      {/* ══ 1. 요약 배너 ══════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: '실효 외화보유 상한',
            value: fmtKRW(effectiveLimit),
            sub: `전체 자금의 ${optimalFxRatio.toFixed(1)}%`,
            cls: 'text-blue-700 dark:text-blue-300',
          },
          {
            label: '현재 외화 보유 총액',
            value: fmtKRW(currentFxKrw),
            sub: `총자금 대비 ${currentFxRatio.toFixed(1)}%`,
            cls: 'text-gray-800 dark:text-slate-100',
          },
          {
            label: isOverLimit ? '⚠ 상한 초과' : '✓ 여유 (상한까지)',
            value: (isOverLimit ? '+' : '') + fmtKRW(Math.abs(fxGap)),
            sub: isOverLimit ? '환전 발의 필요' : '한도 내 보유 중',
            cls: isOverLimit ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400',
          },
          {
            label: decidedLevel !== null && localConfLevel !== decidedLevel
              ? `최대 환율 변동폭 (${localConfLevel}% 🧪시뮬)`
              : decidedLevel !== null
                ? `최대 환율 변동폭 (${localConfLevel}% 🔒의결)`
                : `최대 환율 변동폭 (${localConfLevel}% ⬜미의결)`,
            value: `${(maxRateChange * 100).toFixed(2)}%`,
            sub: `z=${z} · 가중 σ ${(weightedStdSum * 100).toFixed(2)}%`,
            cls: decidedLevel !== null && localConfLevel !== decidedLevel
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-800 dark:text-slate-100',
          },
        ].map(item => (
          <div key={item.label} className={`${card} !p-4 space-y-0.5`}>
            <p className="text-xs text-gray-400 dark:text-gray-500 leading-tight">{item.label}</p>
            <p className={`text-lg font-bold tabular-nums ${item.cls}`}>{item.value}</p>
            <p className="text-xs text-gray-400">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* 초과 보유 경고 배너 */}
      {isOverLimit && (
        <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
              ⚠ 외화 보유량이 정책 상한을 {fmtKRW(fxGap)} 초과했습니다
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
              외화가 계속 누적되어 상한({fmtKRW(effectiveLimit)})을 넘었습니다. 초과분 매도 발의를 검토하세요.
            </p>
          </div>
          <button onClick={() => openTradeModal('total', fxGap)}
            className="shrink-0 text-sm font-medium px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg whitespace-nowrap">
            💱 매도 발의
          </button>
        </div>
      )}

      {/* ══ 2. FX Target Band 모니터링 ══════════════════════════ */}
      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">FX Target Band 모니터링</h3>
          <div className="flex items-center gap-2">
            {isMaster && (
              <button onClick={previewAutoBand} disabled={effectiveLimit <= 0}
                className="text-xs px-2.5 py-1 rounded-lg border border-blue-300 dark:border-blue-700
                           text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30
                           disabled:opacity-40 transition-colors">
                🎯 자동설정
              </button>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              inBand ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                     : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
            }`}>
              {inBand ? '✅ Target 내' : '⚠️ Target 이탈'}
            </span>
          </div>
        </div>

        {(targetMin > 100 || targetMax > 100) && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs">
            <p className="font-semibold text-red-700 dark:text-red-300">⚠️ Target Band 값이 비정상입니다 ({targetMin}~{targetMax}%)</p>
            <p className="text-red-600 dark:text-red-400 mt-0.5">✏️ 파라미터 편집에서 올바른 값으로 수정해 주세요.</p>
          </div>
        )}
        {bandError && (
          <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs">
            <p className="font-semibold text-amber-700 dark:text-amber-300">🎯 자동설정 불가</p>
            <p className="text-amber-600 dark:text-amber-400 mt-0.5">{bandError}</p>
          </div>
        )}
        {bandPreview && (
          <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">🎯 Target Band 자동설정 미리보기</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                  실효한도 비중 {optimalFxRatio.toFixed(1)}% → <strong>상한 {bandPreview.max}%</strong> / 하한 {bandPreview.min}%
                  <span className="ml-1 text-blue-400">(Band폭 {bandPreview.bandWidth}%p = 최대변동폭×2)</span>
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">⚠️ Target Band는 자금정책위원회 의결 사항입니다.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setBandPreview(null)}
                  className="text-xs px-3 py-1.5 border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg">취소</button>
                <button onClick={applyAutoBand}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium">적용 저장</button>
              </div>
            </div>
          </div>
        )}

        <div className="relative mt-8 mb-8">
          <div className="relative h-6 bg-gray-100 dark:bg-slate-700 rounded-full overflow-visible">
            {bandInRange && (
              <div className="absolute top-0 h-full bg-green-200 dark:bg-green-900/40 rounded-full"
                style={{ left: `${clamp(targetMin)}%`, width: `${clamp(targetMax) - clamp(targetMin)}%` }} />
            )}
            <div className={`absolute top-0 h-full w-0.5 ${inBand ? 'bg-blue-600' : 'bg-red-500'}`}
              style={{ left: `${currentPos}%` }} />
            {[25, 50, 75].map(t => (
              <div key={t} className="absolute top-0 h-full w-px bg-gray-300 dark:bg-gray-600 opacity-50"
                style={{ left: `${t}%` }} />
            ))}
          </div>
          <div className={`absolute -top-7 text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap -translate-x-1/2
            ${inBand ? 'bg-blue-600 text-white' : 'bg-red-500 text-white'}`}
            style={{ left: `${currentPos}%` }}>
            현재 {currentFxRatio.toFixed(1)}%
          </div>
          {bandInRange && (
            <>
              <div className="absolute -bottom-5 text-xs text-green-700 dark:text-green-400 font-medium -translate-x-1/2"
                style={{ left: `${clamp(targetMin)}%` }}>{targetMin}%</div>
              <div className="absolute -bottom-5 text-xs text-green-700 dark:text-green-400 font-medium -translate-x-1/2"
                style={{ left: `${clamp(targetMax)}%` }}>{targetMax}%</div>
            </>
          )}
          <div className="flex justify-between text-xs text-gray-300 dark:text-gray-600 mt-1">
            <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">Target Band</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{targetMin}~{targetMax}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">현재 외화비중</p>
            <p className={`text-lg font-bold ${inBand ? 'text-blue-600' : 'text-red-500'}`}>{currentFxRatio.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">현재 외화잔액</p>
            <p className="text-lg font-bold text-gray-700 dark:text-gray-200">{fmtKRW(currentFxKrw)}</p>
          </div>
        </div>
      </div>

      {/* ══ 3. 파라미터 설정 (2컬럼) ══════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 3-L: 손실 허용 기준 */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400">경영 판단 — 연 1회 이상 검토</p>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">손실 허용 기준</h3>
            </div>
            {isMaster && (
              <button onClick={() => setEditingParams(!editingParams)}
                className="text-xs px-2.5 py-1 border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg">
                {editingParams ? '취소' : '✏️ 편집'}
              </button>
            )}
          </div>

          {editingParams && (
            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 space-y-3">
              <p className="text-xs text-blue-700 dark:text-blue-300">※ 자금정책위원회 의결에 따라 조정</p>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { key: 'fx_operating_profit', label: '사업계획 영업이익 (원)', step: 100_000_000 },
                  { key: 'fx_interest_income',  label: '예상 이자수익 (원)',     step: 100_000_000 },
                ].map(({ key, label, step }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-500 dark:text-slate-300">{label}</label>
                    <input type="number" step={step} value={draftParams[key] ?? 0}
                      onChange={e => setDraftParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className="mt-0.5 w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 bg-blue-100/60 dark:bg-blue-900/30 rounded-lg text-xs text-blue-600 dark:text-blue-400">
                💡 Target Band는 파라미터 저장 후 우측 카드 상단의 <strong>🎯 자동설정</strong> 버튼으로 도출합니다.
              </div>
              <button onClick={saveParams} disabled={saving}
                className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3">
                <p className="text-xs text-gray-400">영업이익</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(operatingProfit)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3">
                <p className="text-xs text-gray-400">이자수익</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(interestIncome)}</p>
              </div>
            </div>

            {/* 위험포션 슬라이더 — 로컬 state로 즉각 반응 */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 dark:text-slate-300">위험포션 (Risk Appetite)</span>
                <span className="font-bold text-blue-600 dark:text-blue-400">{localRiskPct.toFixed(0)}%</span>
              </div>
              {isMaster ? (
                <input type="range" className="range-fill" min="10" max="100" step="5"
                  value={localRiskPct}
                  style={riskSliderStyle()}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setLocalRiskPct(v)
                    e.currentTarget.style.setProperty('--fill', `${((v - 10) / 90) * 100}%`)
                  }}
                  onMouseUp={async e => {
                    await params.set('fx_risk_portion', Number((e.target as HTMLInputElement).value) / 100, null, user?.label ?? '')
                  }} />
              ) : (
                <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full">
                  <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${((riskPortion * 100 - 10) / 90) * 100}%` }} />
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-400">
                <span>보수적 10%</span><span>공격적 100%</span>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-400 rounded-r-xl p-3 text-xs text-amber-700 dark:text-amber-300">
              영업이익 {fmtKRW(operatingProfit)} + 이자수익 {fmtKRW(interestIncome)} = <strong>{fmtKRW(operatingProfit + interestIncome)}</strong>의{' '}
              <strong>{localRiskPct.toFixed(0)}%</strong>인{' '}
              <strong>{fmtKRW((operatingProfit + interestIncome) * localRiskPct / 100)}</strong>까지 환손실 허용
            </div>
          </div>
        </div>

        {/* 3-R: 자금 규모 안전장치 + DualLimitVisualizer */}
        <div className={card}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400">신규 — 자금 규모 안전장치</p>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">자금 규모 기반 상한</h3>
            </div>
            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full font-medium whitespace-nowrap">이중 안전장치</span>
          </div>

          {/* 총자금 표시 (읽기 전용) */}
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3 mb-3">
            <p className="text-xs text-gray-400">가용 자금 합계 (자동계산)</p>
            <p className="text-base font-bold text-gray-800 dark:text-slate-100 tabular-nums">{fmtKRW(totalFund)}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              <p className="text-xs text-gray-400">운전 <span className="text-gray-600 dark:text-slate-300">{fmtKRW(operatingCash)}</span></p>
              <p className="text-xs text-gray-400">+ 운용(가용) <span className="text-gray-600 dark:text-slate-300">{fmtKRW(investAvailCash)}</span></p>
              <p className="text-xs text-gray-400">+ 국채(가용) <span className="text-gray-600 dark:text-slate-300">{fmtKRW(bondAvailCash)}</span></p>
              {equityAvailCash > 0 && (
                <p className="text-xs text-gray-400">+ 지분(가용) <span className="text-gray-600 dark:text-slate-300">{fmtKRW(equityAvailCash)}</span></p>
              )}
            </div>
          </div>

          {/* 최대 외화 보유 비율 슬라이더 — 로컬 state */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-slate-300">최대 외화 보유 허용 비율</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">{localMaxFxPct.toFixed(0)}%</span>
            </div>
            {isMaster ? (
              <input type="range" className="range-fill" min="5" max="50" step="5"
                value={localMaxFxPct}
                style={maxFxSliderStyle()}
                onChange={e => {
                  const v = Number(e.target.value)
                  setLocalMaxFxPct(v)
                  e.currentTarget.style.setProperty('--fill', `${((v - 5) / 45) * 100}%`)
                }}
                onMouseUp={async e => {
                  await params.set('fx_max_fx_ratio', Number((e.target as HTMLInputElement).value) / 100, null, user?.label ?? '')
                }} />
            ) : (
              <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded-full">
                <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${((maxFxRatio * 100 - 5) / 45) * 100}%` }} />
              </div>
            )}
            <div className="flex justify-between text-xs text-gray-400">
              <span>낮음 5%</span><span>높음 50%</span>
            </div>
          </div>

          {/* Dual Limit Visualizer */}
          <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-300 mb-3">🔄 이중 한도 비교 — 더 작은 값이 실효 한도</p>
            <div className="flex items-center gap-2">
              <div className={`flex-1 rounded-xl border-2 p-3 text-center transition-colors ${
                aWins
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50'
              }`}>
                <p className={`text-xs font-medium mb-1 ${aWins ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>리스크 기반 한도 A</p>
                <p className={`text-sm font-bold tabular-nums ${aWins ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-slate-300'}`}>
                  {fmtKRW(limitA)}
                </p>
              </div>
              <span className="text-xs text-gray-400 font-medium shrink-0">vs</span>
              <div className={`flex-1 rounded-xl border-2 p-3 text-center transition-colors ${
                !aWins
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50'
              }`}>
                <p className={`text-xs font-medium mb-1 ${!aWins ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>자금규모 한도 B</p>
                <p className={`text-sm font-bold tabular-nums ${!aWins ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-slate-300'}`}>
                  {fmtKRW(limitB)}
                </p>
              </div>
              <span className="text-xs text-gray-400 font-medium shrink-0">→</span>
              <div className="flex-1 rounded-xl border-2 border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20 p-3 text-center">
                <p className="text-xs font-bold text-green-600 dark:text-green-400 mb-1">✓ 실효 한도</p>
                <p className="text-sm font-bold text-green-700 dark:text-green-300 tabular-nums">{fmtKRW(effectiveLimit)}</p>
              </div>
            </div>

            {/* 한도 A 산출 근거 (항상 표시) */}
            <div className="mt-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 mb-1.5 uppercase tracking-wide">📐 한도 A 산출 근거</p>
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{fmtKRW(maxAllowedLoss)}</span>
                  <span className="text-[10px] text-gray-400">허용손실</span>
                </div>
                <span className="text-gray-400 text-base">=</span>
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{fmtKRW(operatingProfit + interestIncome)}</span>
                  <span className="text-[10px] text-gray-400">(영업+이자)</span>
                </div>
                <span className="text-gray-400">×</span>
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{localRiskPct.toFixed(0)}%</span>
                  <span className="text-[10px] text-gray-400">위험포션</span>
                </div>
                <span className="text-gray-300 dark:text-slate-600 mx-1">|</span>
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-blue-600 dark:text-blue-400">{fmtKRW(limitA)}</span>
                  <span className="text-[10px] text-blue-400">한도 A</span>
                </div>
                <span className="text-gray-400 text-base">=</span>
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{fmtKRW(maxAllowedLoss)}</span>
                  <span className="text-[10px] text-gray-400">허용손실</span>
                </div>
                <span className="text-gray-400">÷</span>
                <div className="flex flex-col items-center">
                  <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{(maxRateChange * 100).toFixed(2)}%</span>
                  <span className="text-[10px] text-gray-400">최대변동폭</span>
                </div>
              </div>
            </div>

            <div className="mt-2 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 rounded-r-xl p-3 text-xs text-green-700 dark:text-green-300">
              {aWins
                ? `리스크 기반 한도 A가 더 작아 실효 한도로 적용됩니다. (한도B와 ${fmtKRW(Math.abs(limitA - limitB))} 차이)`
                : `자금 규모 상한 B가 더 작아 실효 한도로 적용됩니다. (한도A와 ${fmtKRW(Math.abs(limitA - limitB))} 차이)`
              }
            </div>
          </div>
        </div>
      </div>

      {/* ══ 4. 통화별 현황 (2컬럼) ════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 4-L: 현재 보유 현황 (바차트) */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400">실시간 연동 — 운전자금 + 운용자금 통화별 잔액</p>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">현재 통화별 보유 현황</h3>
            </div>
          </div>

          <div className="space-y-3">
            {FX_CURRENCIES.map(c => {
              const krwVal    = fxKrwByCode[c.code] ?? 0
              const opNative  = operatingFxNative[c.code] ?? 0
              const invNative = investFxNative[c.code] ?? 0
              const opKrw     = operatingFxKrwByCode[c.code] ?? 0
              const invKrw    = investFxKrwByCode[c.code] ?? 0
              const hasInv    = invNative > 0
              const pct       = totalIndividualFxKrw > 0 ? (krwVal / totalIndividualFxKrw) * 100 : 0
              const opPct     = krwVal > 0 ? (opKrw / krwVal) * 100 : 0
              return (
                <div key={c.code} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 dark:text-slate-400 w-8 shrink-0">{c.code}</span>
                    {/* 분할 바: 운전(진한색) + 운용(연한색) */}
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                      <div className="h-2 transition-all" style={{ width: `${(pct * opPct / 100).toFixed(1)}%`, background: c.color }} />
                      {hasInv && (
                        <div className="h-2 transition-all opacity-40" style={{ width: `${(pct * (100 - opPct) / 100).toFixed(1)}%`, background: c.color }} />
                      )}
                    </div>
                    <span className="text-xs font-medium text-gray-600 dark:text-slate-300 w-10 text-right tabular-nums">{pct.toFixed(1)}%</span>
                    <div className="w-28 text-right">
                      {krwVal > 0 ? (
                        <>
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(krwVal)}</p>
                          <p className="text-[10px] text-gray-400 tabular-nums">{fmtAmt(opNative + invNative, c.code)}</p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-300 dark:text-slate-600">미입력</p>
                      )}
                    </div>
                  </div>
                  {/* 운전/운용 구분 표시 (운용 외화가 있을 때만) */}
                  {hasInv && (
                    <div className="flex gap-3 pl-10 text-[10px]">
                      <span className="flex items-center gap-1 text-gray-400">
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                        운전 {fmtKRW(opKrw)}
                        {opNative > 0 && <span className="text-gray-300">({fmtAmt(opNative, c.code)})</span>}
                      </span>
                      <span className="flex items-center gap-1 text-gray-400">
                        <span className="inline-block w-1.5 h-1.5 rounded-full opacity-40" style={{ background: c.color }} />
                        운용 {fmtKRW(invKrw)}
                        {invNative > 0 && <span className="text-gray-300">({fmtAmt(invNative, c.code)})</span>}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">합계 (원화환산)</span>
                <span className="font-bold text-gray-700 dark:text-gray-200 tabular-nums">
                  {totalIndividualFxKrw > 0 ? fmtKRW(totalIndividualFxKrw) : fx.loading ? '환율 조회 중…' : '잔액 미입력'}
                </span>
              </div>
              {totalIndividualFxKrw > 0 && (() => {
                const totalOpKrw  = Object.values(operatingFxKrwByCode).reduce((s, v) => s + v, 0)
                const totalInvKrw = Object.values(investFxKrwByCode).reduce((s, v) => s + v, 0)
                return totalInvKrw > 0 ? (
                  <div className="flex gap-3 text-[10px] text-gray-400">
                    <span>운전 {fmtKRW(totalOpKrw)}</span>
                    <span className="opacity-50">+</span>
                    <span>운용 {fmtKRW(totalInvKrw)}</span>
                  </div>
                ) : null
              })()}
            </div>
          </div>

          <div className="mt-4 border-t border-gray-100 dark:border-slate-700 pt-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-300 mb-2">목표 통화 구성 비중 설정</p>
            <div className="space-y-2">
              {FX_CURRENCIES.map(c => {
                const row    = currencyRows.find(r => r.code === c.code)!
                const actual = totalIndividualFxKrw > 0
                  ? (fxKrwByCode[c.code] / totalIndividualFxKrw * 100).toFixed(1)
                  : null
                return (
                  <div key={c.code} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-8 text-gray-500 dark:text-slate-400">{c.code}</span>
                    <span className="flex-1 text-xs text-gray-400">{actual ? `현재 ${actual}%` : '잔액 미입력'}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="1"
                        value={localWeights[c.code] ?? Math.round(row.wgt * 100)}
                        disabled={!isMaster}
                        onChange={e => setLocalWeights(p => ({ ...p, [c.code]: Number(e.target.value) }))}
                        onBlur={async e => {
                          const v = Number(e.target.value) / 100
                          await params.set(c.wgtKey, v, null, user?.label ?? '')
                        }}
                        className="w-14 text-xs text-right border border-gray-200 dark:border-slate-600 rounded px-2 py-1
                                   bg-white dark:bg-slate-700 text-gray-800 dark:text-white disabled:bg-gray-50 dark:disabled:bg-slate-700/50" />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  </div>
                )
              })}
              {(() => {
                const wSum = Object.values(localWeights).reduce((s, v) => s + v, 0)
                return (
                  <p className={`text-xs pt-1 ${wSum === 100 ? 'text-green-600 dark:text-green-400' : 'text-amber-500 font-medium'}`}>
                    {wSum === 100 ? '✓ 합계: 100%' : `⚠ 합계: ${wSum}% — 100%가 되도록 조정하세요`}
                  </p>
                )
              })()}
            </div>
          </div>
        </div>

        {/* 4-R: 환율 변동폭 설정 */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-400">분기 업데이트 — 한국은행 ECOS API</p>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">환율 변동폭 설정</h3>
            </div>
            {isMaster && (
              <div className="flex items-center gap-2">
                <button onClick={handleAutoCalcStdDev} disabled={autoCalcState === 'loading'}
                  title="한국은행 ECOS API에서 4개 통화 1년치 데이터를 조회합니다. 정상적으로도 2~3분 이상 걸릴 수 있습니다."
                  className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700
                             text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
                  {autoCalcState === 'loading' ? '⏳ 조회 중…' : '🔄 ECOS 자동'}
                </button>
                {autoCalcState === 'loading' && (
                  <span className="text-[10px] text-gray-400">최대 3~4분 소요될 수 있어요 (ECOS API 응답 지연)</span>
                )}
                <button onClick={() => setEditingStd(!editingStd)}
                  className="text-xs px-2.5 py-1 border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg">
                  {editingStd ? '취소' : '✏️ 수동'}
                </button>
              </div>
            )}
          </div>

          {/* 신뢰도 선택 */}
          <div className="mb-3">
            {/* 의결 상태 배지 */}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
              <p className="text-xs text-gray-500 dark:text-slate-300">보수성 수준 선택 — 클릭 시 즉시 시뮬레이션</p>
              {decidedLevel !== null ? (
                <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-medium border border-blue-200 dark:border-blue-700">
                  🔒 의결 {decidedLevel}%
                  {decidedDate && <span className="text-blue-400 font-normal">· {decidedDate}</span>}
                  {decidedMeetingLabel && <span className="text-blue-400 font-normal hidden sm:inline">· {decidedMeetingLabel}</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400 border border-gray-200 dark:border-slate-600">
                  ⬜ 미의결 — 정책회의 의결 필요
                </span>
              )}
            </div>

            {/* 시뮬레이션 중 배너 (sim ≠ decided) */}
            {decidedLevel !== null && localConfLevel !== decidedLevel && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-300">
                <span className="shrink-0">🧪 시뮬레이션 중</span>
                <span className="text-amber-600 dark:text-amber-400">
                  현재 선택 <strong>{localConfLevel}%</strong>는 의결 기준 <strong>{decidedLevel}%</strong>과 다릅니다.
                  {(() => {
                    const simVol     = weightedStdSum * Z_TABLE[localConfLevel]
                    const decidedVol = weightedStdSum * Z_TABLE[decidedLevel]
                    const diff       = (simVol - decidedVol) * 100
                    return diff !== 0
                      ? <span className="ml-1">최대변동폭 <span className={diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>{diff > 0 ? '+' : ''}{diff.toFixed(2)}%p</span></span>
                      : null
                  })()}
                </span>
                <span className="ml-auto shrink-0 text-amber-500 dark:text-amber-400">저장 안 됨</span>
              </div>
            )}

            <div className="flex gap-2 mb-2">
              {([90, 95, 99] as ConfLevel[]).map(lv => {
                const lvZ        = Z_TABLE[lv]
                const lvMaxVol   = weightedStdSum * lvZ
                const lvLimitA   = lvMaxVol > 0 ? maxAllowedLoss / lvMaxVol : 0
                const isActive   = localConfLevel === lv
                const isDecided  = decidedLevel === lv
                return (
                  <button key={lv}
                    onClick={async () => {
                      setLocalConfLevel(lv)
                      // master만 sim값 저장; 나머지는 로컬 시뮬레이션만
                      if (isMaster) await params.set('fx_confidence_level', lv, null, user?.label ?? '')
                    }}
                    className={`flex-1 py-2 px-1 rounded-lg border-2 text-center transition-all cursor-pointer
                      ${isDecided && isActive
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-sm'
                        : isDecided
                          ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-700'
                          : isActive
                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600 shadow-sm'
                            : 'border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50 hover:border-blue-300'
                      }`}>
                    <div className="flex items-center justify-center gap-1">
                      <p className={`text-sm font-bold ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-slate-300'}`}>{lv}%</p>
                      {isDecided && <span className="text-[10px]">🔒</span>}
                    </div>
                    <p className="text-xs text-gray-400">{lv === 90 ? '일반' : lv === 95 ? '표준' : '엄격'} z={lvZ}</p>
                    <p className={`text-xs tabular-nums mt-0.5 font-medium ${isActive ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400'}`}>
                      {fmtKRW(lvLimitA)}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* master: 의결 확정 UI */}
            {isMaster && (
              <div className="mb-2">
                {!decidingConf ? (
                  <button
                    onClick={() => { setDecidingConf(true); setDecideMeeting('') }}
                    className="w-full text-xs py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors font-medium">
                    🔒 현재 선택({localConfLevel}%)을 의결 기준으로 확정
                  </button>
                ) : (
                  <div className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">🔒 의결 기준 확정 — {localConfLevel}%</p>
                    <div>
                      <label className="text-[11px] text-blue-600 dark:text-blue-400">회의명 (선택)</label>
                      <input
                        type="text"
                        value={decideMeeting}
                        onChange={e => setDecideMeeting(e.target.value)}
                        placeholder="예: 2026년 2차 자금정책회의"
                        className="mt-0.5 w-full text-xs border border-blue-200 dark:border-blue-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDecidingConf(false)}
                        className="flex-1 text-xs py-1.5 rounded-lg border border-blue-200 dark:border-blue-700 text-blue-500 hover:bg-white dark:hover:bg-slate-800">취소</button>
                      <button onClick={handleDecideConf} disabled={decideSaving}
                        className="flex-1 text-xs py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium">
                        {decideSaving ? '저장 중…' : '확정 저장'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 신뢰도별 한도 A 영향 미리보기 */}
            <div className="rounded-lg bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-700 px-3 py-2 text-xs">
              <p className="text-gray-400 dark:text-gray-500 mb-1.5">신뢰도별 리스크 기반 한도 A 변화</p>
              {([90, 95, 99] as ConfLevel[]).map(lv => {
                const lvZ      = Z_TABLE[lv]
                const lvMaxVol = weightedStdSum * lvZ
                const lvLimitA = lvMaxVol > 0 ? maxAllowedLoss / lvMaxVol : 0
                const barPct   = Math.min((lvLimitA / Math.max(maxAllowedLoss / (weightedStdSum * Z_TABLE[90]), 1)) * 100, 100)
                const isDecided = decidedLevel === lv
                return (
                  <div key={lv} className={`flex items-center gap-2 mb-1 ${localConfLevel === lv ? 'opacity-100' : 'opacity-55'}`}>
                    <span className={`w-8 font-medium flex items-center gap-0.5 ${localConfLevel === lv ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}>
                      {lv}%{isDecided && <span className="text-[9px]">🔒</span>}
                    </span>
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${localConfLevel === lv ? 'bg-blue-500' : 'bg-gray-300 dark:bg-slate-500'}`}
                        style={{ width: `${barPct}%` }} />
                    </div>
                    <span className={`w-20 text-right tabular-nums ${localConfLevel === lv ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400'}`}>
                      {fmtKRW(lvLimitA)}
                    </span>
                    <span className="w-14 text-gray-400 text-[10px]">÷{(lvMaxVol * 100).toFixed(2)}%</span>
                  </div>
                )
              })}
              <p className="text-[10px] text-gray-400 mt-1.5 border-t border-gray-200 dark:border-slate-600 pt-1.5">
                허용손실 {fmtKRW(maxAllowedLoss)} ÷ (가중σ×z) = 한도A — 신뢰도 높을수록 한도 좁아짐
              </p>
            </div>
          </div>

          {autoCalcMsg && (
            <div className={`mb-3 px-3 py-2 rounded-xl text-xs ${
              autoCalcState === 'done'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}>
              {autoCalcMsg}
              {autoCalcState === 'error' && (
                <p className="mt-1">GAS 스크립트 속성에 <code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">ECOS_API_KEY</code> 필요</p>
              )}
            </div>
          )}

          {editingStd && (
            <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 space-y-2">
              <p className="text-xs text-blue-700 dark:text-blue-300">※ 연간(√252) 수익률 표준편차</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {FX_CURRENCIES.map(c => {
                  const row = currencyRows.find(r => r.code === c.code)!
                  return (
                    <div key={c.code}>
                      <p className="text-xs font-medium text-gray-600 dark:text-slate-200">{c.code}</p>
                      <div className="flex gap-1">
                        <input type="number" step="0.000001" placeholder="표준편차"
                          value={draftStd[c.stdKey] ?? row.std}
                          onChange={e => setDraftStd(p => ({ ...p, [c.stdKey]: Number(e.target.value) }))}
                          className="w-0 flex-1 text-xs border border-gray-300 dark:border-slate-600 rounded px-1.5 py-1
                                     bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                      </div>
                    </div>
                  )
                })}
              </div>
              <button onClick={saveStd} disabled={saving}
                className="w-full py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          )}

          {/* 통화별 변동폭 그리드 */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {FX_CURRENCIES.map(c => {
              const row = currencyRows.find(r => r.code === c.code)!
              return (
                <div key={c.code} className={`p-3 rounded-lg border ${
                  row.wgt > 0
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600'
                }`}>
                  <p className="text-xs text-gray-400 mb-1">{c.code} σ</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: c.color }}>
                    {(row.std * 100).toFixed(2)}%
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    가중: {(row.wgt * row.std * 100).toFixed(3)}%
                  </p>
                </div>
              )
            })}
          </div>

          {/* 결과 */}
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">적용 최대 환율 변동폭 ({localConfLevel}% 신뢰도, z={z})</p>
            <p className="text-3xl font-extrabold text-gray-800 dark:text-slate-100 tabular-nums">{(maxRateChange * 100).toFixed(2)}%</p>
            <p className="text-xs text-gray-400 mt-1">{(weightedStdSum * 100).toFixed(3)}% × {z} = {(maxRateChange * 100).toFixed(3)}%</p>
          </div>
          <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 rounded-r-xl p-3 text-xs text-blue-700 dark:text-blue-300">
            향후 1년간 보유 외화의 원화 환산 가치가 최악의 경우 <strong>{(maxRateChange * 100).toFixed(2)}%</strong> 하락할 수 있다는 통계적 추정입니다.
          </div>
        </div>
      </div>

      {/* ══ 5. 통화별 상한 vs 현재 보유량 테이블 ════════════════════ */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            통화별 정책 상한 vs 현재 보유량
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            외화 누적 시 상한 초과 여부 확인 — 초과 통화는 매도 발의
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs">
                <th className="text-left pb-2 pr-3 text-gray-400 font-medium">통화</th>
                <th className="text-right pb-2 pr-3 text-gray-400 font-medium">정책 비중</th>
                <th className="text-right pb-2 pr-3 font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-t-lg px-2">
                  정책 상한 (KRW)
                </th>
                <th className="text-right pb-2 pr-3 font-medium bg-slate-50 dark:bg-slate-700/40 text-gray-700 dark:text-slate-200 rounded-t-lg px-2">
                  현재 보유 (KRW)
                </th>
                <th className="text-right pb-2 pr-3 text-gray-400 font-medium">보유 외화</th>
                <th className="text-right pb-2 pr-3 text-gray-400 font-medium">초과 / 여유</th>
                <th className="text-center pb-2 text-gray-400 font-medium">조치</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.filter(r => r.wgt > 0).map(r => {
                const isOver  = r.excess > r.ceilKrw * 0.05   // 5% 이상 초과
                const fxNative = fxBalances[r.code] ?? 0
                return (
                  <tr key={r.code} className="border-b border-gray-50 dark:border-slate-700/50">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-200">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                        {r.code}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-500">{(r.wgt * 100).toFixed(0)}%</td>
                    {/* 정책 상한 — 파란 배경 */}
                    <td className="py-2.5 pr-3 text-right tabular-nums bg-blue-50 dark:bg-blue-900/20 px-2">
                      <span className="font-medium text-blue-700 dark:text-blue-300">{fmtKRW(r.ceilKrw)}</span>
                    </td>
                    {/* 현재 보유 — 초과 시 주황/빨간, 아니면 초록/회색 */}
                    <td className={`py-2.5 pr-3 text-right tabular-nums px-2 ${
                      isOver
                        ? 'bg-red-50 dark:bg-red-900/20'
                        : 'bg-slate-50 dark:bg-slate-700/40'
                    }`}>
                      <span className={`font-medium ${
                        isOver ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'
                      }`}>{fmtKRW(r.krwVal)}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-xs text-gray-500 dark:text-slate-400">
                      {fxNative > 0 ? fmtAmt(fxNative, r.code) : '—'}
                    </td>
                    <td className={`py-2.5 pr-3 text-right tabular-nums text-xs font-medium ${
                      isOver ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                    }`}>
                      {isOver ? '+' : ''}{fmtKRW(r.excess)}
                    </td>
                    <td className="py-2.5 text-center">
                      {isOver ? (
                        <button onClick={() => openTradeModal(r.code, r.excess)}
                          className="text-xs px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium whitespace-nowrap">
                          매도 발의
                        </button>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 rounded-full">
                          ✓ 한도 내
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* 합계 행 */}
              <tr className="border-t border-gray-200 dark:border-slate-600">
                <td colSpan={2} className="pt-3 text-xs text-gray-500 dark:text-slate-400 font-medium">합계</td>
                <td className="pt-3 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2">
                  {fmtKRW(effectiveLimit)}
                </td>
                <td className={`pt-3 text-right tabular-nums font-bold px-2 ${
                  isOverLimit
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                    : 'bg-slate-50 dark:bg-slate-700/40 text-green-700 dark:text-green-300'
                }`}>
                  {fmtKRW(currentFxKrw)}
                </td>
                <td />
                <td className={`pt-3 text-right tabular-nums font-bold text-xs ${
                  isOverLimit ? 'text-red-500' : 'text-green-600'
                }`}>
                  {isOverLimit ? '+' : ''}{fmtKRW(fxGap)}
                </td>
                <td className="pt-3 text-center">
                  {isOverLimit ? (
                    <button onClick={() => openTradeModal('total', fxGap)}
                      className="text-xs px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium whitespace-nowrap">
                      전체 발의
                    </button>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 rounded-full">
                      ✓ 한도 내
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 한도 내 상태 안내 */}
        {!isOverLimit && (
          <div className="mt-4 px-4 py-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl text-xs text-green-700 dark:text-green-300">
            ✓ 현재 외화 보유량이 정책 상한({fmtKRW(effectiveLimit)}) 이내입니다. 추가 조치 불필요.
          </div>
        )}
      </div>

      {/* ══ 환전 발의 모달 ════════════════════════════════════════ */}
      {tradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setTradeModal(null) }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-slate-700"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700 flex items-start justify-between">
              <div>
                <p className="text-base font-semibold text-gray-800 dark:text-slate-100">
                  💱 외화 매도 발의 {tradeModal.code !== 'total' ? `— ${tradeModal.code}` : '(전체)'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  외화 누적 → 상한 초과분 원화 전환 발의
                </p>
              </div>
              <button onClick={() => setTradeModal(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* 초과 금액 안내 */}
              <div className="px-3 py-2.5 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-xl text-xs">
                <p className="font-medium text-orange-700 dark:text-orange-300">초과 보유 금액</p>
                <p className="text-orange-600 dark:text-orange-400 tabular-nums font-bold text-sm mt-0.5">
                  {fmtKRW(tradeModal.excessKrw)}
                  {tradeModal.code !== 'total' && (
                    <span className="font-normal text-xs ml-2">
                      (상한 대비 {tradeModal.code} {fmtAmt(tradeModal.excessKrw / fx.toKRW(1, tradeModal.code), tradeModal.code)} 초과)
                    </span>
                  )}
                </p>
              </div>

              {/* 매도 금액 (외화) */}
              {tradeModal.code !== 'total' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">
                    매도 금액 ({tradeModal.code})
                  </label>
                  <div className="flex gap-2">
                    <input type="number" value={tradeAmt}
                      onChange={e => setTradeAmt(e.target.value)}
                      className="flex-1 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums"
                      placeholder={`${tradeModal.code} 금액`} />
                    <button onClick={() => {
                      const rate = fx.toKRW(1, tradeModal.code as FxCode)
                      setTradeAmt(rate > 0 ? Math.ceil(tradeModal.excessKrw / rate).toString() : '')
                    }}
                      className="text-xs px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      초과분 전액
                    </button>
                  </div>
                  {tradeAmt && (
                    <p className="text-xs text-gray-400 mt-1 tabular-nums">
                      ≈ {fmtKRW(Number(tradeAmt) * fx.toKRW(1, tradeModal.code as FxCode))} ({fmtNumber(fx.toKRW(1, tradeModal.code as FxCode), 2)}원/{tradeModal.code})
                    </p>
                  )}
                </div>
              )}

              {/* 취득환율 / 매도(예정)환율 */}
              {tradeModal.code !== 'total' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">
                      취득 환율 <span className="text-gray-400">(원/{tradeModal.code})</span>
                    </label>
                    <input type="number" step="0.01" value={tradeAcqRate}
                      onChange={e => setTradeAcqRate(e.target.value)}
                      className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums"
                      placeholder="예: 1320.00" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">
                      매도(예정) 환율 <span className="text-gray-400">(원/{tradeModal.code})</span>
                    </label>
                    <input type="number" step="0.01" value={tradeSellRate}
                      onChange={e => setTradeSellRate(e.target.value)}
                      className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                                 bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums"
                      placeholder="현재 시장 환율" />
                  </div>
                </div>
              )}

              {/* 환차손익 자동계산 */}
              {tradeModal.code !== 'total' && tradeFxPnl != null && (
                <div className={`px-3 py-2.5 rounded-xl border text-xs ${
                  tradeFxPnl >= 0
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                    : 'bg-red-50   dark:bg-red-950/30   border-red-200   dark:border-red-800'
                }`}>
                  <p className={`font-medium mb-0.5 ${tradeFxPnl >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    📐 예상 환차{tradeFxPnl >= 0 ? '익' : '손'}
                  </p>
                  <p className={`tabular-nums font-bold text-sm ${tradeFxPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {tradeFxPnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(tradeFxPnl))}
                  </p>
                  <p className="text-gray-400 dark:text-slate-500 mt-0.5">
                    ({fmtNumber(Number(tradeSellRate) - Number(tradeAcqRate), 2)}원/{tradeModal.code}) × {fmtNumber(Number(tradeAmt), 0)} {tradeModal.code}
                  </p>
                </div>
              )}

              {/* 희망 집행일 */}
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">희망 집행 시기</label>
                <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>

              {/* 발의 사유 */}
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">발의 사유</label>
                <textarea rows={3} value={tradeMemo} onChange={e => setTradeMemo(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 resize-none
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>

              {/* 저장 방식 안내 */}
              <div className="px-3 py-2 border-l-2 border-blue-400 rounded-r-lg bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300">
                제출 시 후속조치 스레드 기록 + <b>외화매매거래 이력</b>에 자동 등록됩니다.<br/>
                관리자 승인 후 실제 체결 환율로 완료 처리합니다.
              </div>
            </div>

            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setTradeModal(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                취소
              </button>
              <button onClick={submitTradeProposal} disabled={tradeSaving}
                className="px-5 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white rounded-lg disabled:opacity-50">
                {tradeSaving ? '제출 중...' : '매도 발의 제출'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
