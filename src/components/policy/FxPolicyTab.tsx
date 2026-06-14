import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useDaily } from '../../hooks/useDaily'
import { useInvestments, getLatestInvestments, getLatestBonds } from '../../hooks/useInvestments'
import { useFx } from '../../hooks/useFx'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { fetchFxStdDev } from '../../hooks/useGas'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { restInsert } from '../../lib/supabase'
import { generateUUID } from '../../lib/format'
import type { Company, FxCode } from '../../types'

const FX_META: Record<FxCode, { name: string; flag: string }> = {
  USD: { name: '미국 달러',   flag: '🇺🇸' },
  EUR: { name: '유로',        flag: '🇪🇺' },
  JPY: { name: '일본 엔',     flag: '🇯🇵' },
  GBP: { name: '영국 파운드', flag: '🇬🇧' },
  CNY: { name: '중국 위안',   flag: '🇨🇳' },
}

const FX_CURRENCY_DEFAULTS = [
  { code: 'USD' as FxCode, stdKey: 'fx_std_usd', wgtKey: 'fx_weight_usd', defaultStd: 0.082458, defaultWgt: 0.80 },
  { code: 'EUR' as FxCode, stdKey: 'fx_std_eur', wgtKey: 'fx_weight_eur', defaultStd: 0.114437, defaultWgt: 0.18 },
  { code: 'JPY' as FxCode, stdKey: 'fx_std_jpy', wgtKey: 'fx_weight_jpy', defaultStd: 0.108875, defaultWgt: 0.02 },
  { code: 'GBP' as FxCode, stdKey: 'fx_std_gbp', wgtKey: 'fx_weight_gbp', defaultStd: 0.130257, defaultWgt: 0.00 },
]
const Z_95 = 1.6503  // NORM.S.INV(0.95) 엑셀 검증값 (기존 1.645 → 미세 조정)

export default function FxPolicyTab({ company }: { company: Company }) {
  const { user } = useAuth()
  const isMaster  = user?.role === 'master'
  const daily     = useDaily()
  const invest    = useInvestments(true)   // active only
  const fx        = useFx()
  const params    = usePolicyParams(company)

  const riskPortion     = params.get('fx_risk_portion') ?? 0.5
  const targetMin       = params.get('fx_target_min') ?? 20
  const targetMax       = params.get('fx_target_max') ?? 25
  const operatingProfit = params.get('fx_operating_profit') ?? 4_300_000_000
  const interestIncome  = params.get('fx_interest_income') ?? 2_300_000_000

  const currencyRows = FX_CURRENCY_DEFAULTS.map(c => ({
    ...c,
    std: params.get(c.stdKey) ?? c.defaultStd,
    wgt: params.get(c.wgtKey) ?? c.defaultWgt,
  }))

  const weightedStdSum = currencyRows.reduce((s, r) => s + r.wgt * r.std, 0)
  const maxRateChange  = weightedStdSum * Z_95

  const [editingBase, setEditingBase] = useState(false)
  const [editingStd,  setEditingStd]  = useState(false)
  const [autoCalcState, setAutoCalcState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [autoCalcMsg, setAutoCalcMsg] = useState<string | null>(null)
  // Target Band 자동설정
  const [bandPreview, setBandPreview] = useState<{ min: number; max: number; bandWidth: number } | null>(null)
  const [draftBase, setDraftBase] = useState({
    fx_risk_portion: riskPortion, fx_target_min: targetMin, fx_target_max: targetMax,
    fx_operating_profit: operatingProfit, fx_interest_income: interestIncome,
  })
  const [draftStd, setDraftStd] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingBase) setDraftBase({
      fx_risk_portion: riskPortion, fx_target_min: targetMin, fx_target_max: targetMax,
      fx_operating_profit: operatingProfit, fx_interest_income: interestIncome,
    })
  }, [editingBase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingStd) {
      const init: Record<string, number> = {}
      currencyRows.forEach(r => { init[r.stdKey] = r.std; init[r.wgtKey] = r.wgt })
      setDraftStd(init)
    }
  }, [editingStd]) // eslint-disable-line react-hooks/exhaustive-deps

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
      setAutoCalcMsg(
        `✅ ${period.from.slice(0,4)}-${period.from.slice(4,6)}-${period.from.slice(6)} ~ ` +
        `${period.to.slice(0,4)}-${period.to.slice(4,6)}-${period.to.slice(6)} ` +
        `(${dataCount}일) 기준 갱신됨`
      )
    } catch (err) {
      setAutoCalcState('error')
      setAutoCalcMsg(err instanceof Error ? err.message : '알 수 없는 오류')
    }
  }

  // Target Band 자동설정: Max = optimalFxRatio(반올림), Min = Max - 동적 폭
  const [bandError, setBandError] = useState<string | null>(null)
  function previewAutoBand() {
    setBandError(null)
    if (optimalFxRatio <= 0) {
      setBandError('적정 외화보유 비율을 계산할 수 없습니다. 파라미터를 확인하세요.')
      return
    }
    if (optimalFxRatio > 100) {
      setBandError(
        `적정 외화보유한도(${fmtKRW(optimalFxLimit)})가 전체 자금(${fmtKRW(totalFund)})을 초과합니다. ` +
        `현재 자금 규모에서는 외화 보유 여력이 충분하므로 Target Band를 ✏️ 파라미터 편집에서 직접 설정하세요.`
      )
      return
    }
    const max = Math.round(optimalFxRatio * 10) / 10
    // Band 폭: 최대환율변동폭(%) × 2 기반, 최소 2%p ~ 최대 10%p 클램핑
    const dynamicBandWidth = Math.min(Math.max(Math.round(maxRateChange * 2 * 1000) / 10, 2), 10)
    const min = Math.round((max - dynamicBandWidth) * 10) / 10
    setBandPreview({ min: Math.max(0, min), max, bandWidth: dynamicBandWidth })
  }

  async function applyAutoBand() {
    if (!bandPreview) return
    // 거버넌스: Target Band는 자금정책위원회 의결 사항 — 저장 전 확인 필수
    const confirmed = window.confirm(
      `[자금정책위원회 의결 사항]\n\n` +
      `FX Target Band를 다음과 같이 변경합니다.\n` +
      `  기존: ${targetMin}% ~ ${targetMax}%\n` +
      `  변경: ${bandPreview.min}% ~ ${bandPreview.max}%\n\n` +
      `위원회 의결 후 저장하세요. 계속하시겠습니까?`
    )
    if (!confirmed) return

    const prevMin = targetMin
    const prevMax = targetMax
    await params.set('fx_target_min', bandPreview.min, null, user?.label ?? '')
    await params.set('fx_target_max', bandPreview.max, null, user?.label ?? '')

    // 변경 이력을 issue_comments에 자동 기록
    await restInsert('issue_comments', {
      id: generateUUID(),
      issue_key: `policy_fx_band_${company}`,
      body: `📋 FX Target Band 변경 (${user?.label ?? ''})\n이전: ${prevMin}%~${prevMax}% → 변경: ${bandPreview.min}%~${bandPreview.max}%\n근거: 적정 외화보유 비율 ${optimalFxRatio.toFixed(1)}%, 변동폭 기반 Band 폭 ${bandPreview.bandWidth}%p`,
      created_by: user?.label ?? '',
    })
    setBandPreview(null)
  }

  async function saveBase() {
    setSaving(true)
    for (const [k, v] of Object.entries(draftBase)) await params.set(k, v as number, null, user?.label ?? '')
    setSaving(false); setEditingBase(false)
  }

  async function saveStd() {
    setSaving(true)
    for (const [k, v] of Object.entries(draftStd)) await params.set(k, v, null, user?.label ?? '')
    setSaving(false); setEditingStd(false)
  }

  const latestDaily = useMemo(() => daily.data[0] ?? null, [daily.data])

  // ── 운전자금 (운전자금 최신 잔고)
  const operatingCash = useMemo(() => latestDaily
    ? (latestDaily.krw_demand + latestDaily.krw_govt + latestDaily.krw_mmda + latestDaily.fx_krw)
    : 0, [latestDaily])

  // ── 운용자금 (비국채 active 합계)
  const investCash = useMemo(() => {
    const latest = getLatestInvestments(invest.data)
    return latest
      .filter(i => i.product !== '국채')
      .reduce((s, i) => s + (i.amount || 0), 0)
  }, [invest.data])

  // ── 국채 평가금액 (종목별 최신 1건 × bondQty × bondPrice ÷ 10)
  const bondCash = useMemo(() => {
    const latestBonds = getLatestBonds(invest.data)
    return latestBonds.reduce((s, b) => {
      if (b.bondQty && b.bondPrice) return s + b.bondQty * b.bondPrice / 10
      return s + (b.amount || 0)
    }, 0)
  }, [invest.data])

  // ── 전체 자금 총액 = 운전자금 + 운용자금(비국채) + 국채 평가금액
  const totalFund = operatingCash + investCash + bondCash

  const currentFxKrw   = latestDaily?.fx_krw ?? 0
  // 현재 외화비중 = 외화잔액 / 전체 자금(운전+운용) — optimalFxRatio와 동일 기준
  const currentFxRatio = totalFund > 0 ? (currentFxKrw / totalFund) * 100 : 0

  const maxAllowedLoss = (operatingProfit + interestIncome) * riskPortion
  const optimalFxLimit = maxRateChange > 0 ? maxAllowedLoss / maxRateChange : 0
  const optimalFxRatio = totalFund > 0 ? (optimalFxLimit / totalFund) * 100 : 0

  const fxBalances: Record<FxCode, number> = {
    USD: latestDaily?.fx_usd ?? 0, EUR: latestDaily?.fx_eur ?? 0,
    JPY: latestDaily?.fx_jpy ?? 0, GBP: latestDaily?.fx_gbp ?? 0, CNY: latestDaily?.fx_cny ?? 0,
  }

  // 실보유 비율 계산 (외화별 원화환산 / 전체 외화잔액)
  // 테이블 표시 전용 — 표준편차 계산은 currencyRows(정책 가중치) 사용
  const individualFxKrwTotal = currencyRows.reduce(
    (s, r) => s + fx.toKRW(fxBalances[r.code as FxCode] ?? 0, r.code as FxCode), 0
  )
  // 개별 통화 잔액이 입력되지 않고 합산 fx_krw만 있는 경우 실비율 계산 불가
  const hasIndividualFxData = individualFxKrwTotal > currentFxKrw * 0.1
  const currencyRowsWithActual = currencyRows.map(r => {
    const actualKrw = fx.toKRW(fxBalances[r.code as FxCode] ?? 0, r.code as FxCode)
    const actualWgt = hasIndividualFxData && currentFxKrw > 0 ? actualKrw / currentFxKrw : null
    const wgtDrift  = actualWgt !== null && Math.abs(r.wgt - actualWgt) > 0.15
    return { ...r, actualWgt, wgtDrift }
  })

  // 게이지: 0~100% 고정 스케일
  // Target Band가 100% 초과이면 게이지에 표시하지 않음
  const bandInRange  = targetMin <= 100 && targetMax <= 100
  const clamp        = (v: number) => Math.min(Math.max(v, 0), 100)
  const currentPos   = clamp(currentFxRatio)          // 0~100% 내 현재 위치
  const targetMinPos = bandInRange ? clamp(targetMin) : 0
  const targetMaxPos = bandInRange ? clamp(targetMax) : 0
  const inBand       = bandInRange && currentFxRatio >= targetMin && currentFxRatio <= targetMax

  return (
    <div className="space-y-5">

      {/* ── Target Band 게이지 ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">FX Target Band 모니터링</h3>
          <div className="flex items-center gap-2">
            {isMaster && (
              <button
                onClick={previewAutoBand}
                disabled={optimalFxRatio <= 0}
                title="적정 외화보유 비율 기준으로 Target Band 자동설정"
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

        {/* Target Band가 100% 초과로 저장된 경우 경고 */}
        {(targetMin > 100 || targetMax > 100) && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-0.5">
              ⚠️ Target Band 값이 비정상입니다 ({targetMin}~{targetMax}%)
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              이전 자동설정으로 잘못된 값이 저장됐습니다. ✏️ 파라미터 편집에서 올바른 값으로 수정해 주세요.
            </p>
          </div>
        )}

        {/* 자동설정 오류 메시지 */}
        {bandError && (
          <div className="mb-4 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5">🎯 자동설정 불가</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">{bandError}</p>
          </div>
        )}

        {/* 자동설정 미리보기 배너 */}
        {bandPreview && (
          <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-0.5">
                  🎯 Target Band 자동설정 미리보기
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  적정 외화보유 비율 {optimalFxRatio.toFixed(1)}% 기준
                  → <strong>Min {bandPreview.min}%</strong> ~ <strong>Max {bandPreview.max}%</strong>
                  <span className="ml-1 text-blue-400">(Band 폭 {bandPreview.bandWidth}%p = 변동폭 {(maxRateChange * 100).toFixed(1)}% × 2)</span>
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  ⚠️ Target Band는 자금정책위원회 의결 사항입니다. 저장 전 반드시 확인하세요.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setBandPreview(null)}
                  className="text-xs px-3 py-1.5 border border-blue-300 dark:border-blue-700
                             text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40">
                  취소
                </button>
                <button onClick={applyAutoBand}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                  적용 저장
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 0~100% 고정 게이지 */}
        <div className="relative mt-8 mb-8">
          {/* 배경 바 */}
          <div className="relative h-6 bg-gray-100 dark:bg-gray-700 rounded-full overflow-visible">

            {/* Target Band 구간 (0~100% 내에 있을 때만 표시) */}
            {bandInRange && targetMaxPos > targetMinPos && (
              <div className="absolute top-0 h-full bg-green-200 dark:bg-green-900/40 rounded-full"
                style={{ left: `${targetMinPos}%`, width: `${targetMaxPos - targetMinPos}%` }} />
            )}

            {/* 현재 비중 바늘 */}
            <div
              className={`absolute top-0 h-full w-0.5 transition-all ${inBand ? 'bg-blue-600' : 'bg-red-500'}`}
              style={{ left: `${currentPos}%` }}
            />

            {/* 눈금선 (25%, 50%, 75%) */}
            {[25, 50, 75].map(tick => (
              <div key={tick} className="absolute top-0 h-full w-px bg-gray-300 dark:bg-gray-600 opacity-50"
                style={{ left: `${tick}%` }} />
            ))}
          </div>

          {/* 현재 비중 레이블 (바늘 위) */}
          <div
            className={`absolute -top-7 text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap -translate-x-1/2
              ${inBand ? 'bg-blue-600 text-white' : 'bg-red-500 text-white'}`}
            style={{ left: `${currentPos}%` }}>
            현재 {currentFxRatio.toFixed(1)}%
          </div>

          {/* Target Band 레이블 (바 아래) */}
          {bandInRange && (
            <>
              <div className="absolute -bottom-5 text-xs text-green-700 dark:text-green-400 font-medium -translate-x-1/2"
                style={{ left: `${targetMinPos}%` }}>{targetMin}%</div>
              <div className="absolute -bottom-5 text-xs text-green-700 dark:text-green-400 font-medium -translate-x-1/2"
                style={{ left: `${targetMaxPos}%` }}>{targetMax}%</div>
            </>
          )}

          {/* 눈금 레이블 */}
          <div className="flex justify-between text-xs text-gray-300 dark:text-gray-600 mt-1 px-0">
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
            <p className={`text-lg font-bold ${inBand ? 'text-blue-600' : 'text-red-500'}`}>
              {currentFxRatio.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">현재 외화잔액</p>
            <p className="text-lg font-bold text-gray-700 dark:text-gray-200">{fmtKRW(currentFxKrw)}</p>
          </div>
        </div>
      </div>

      {/* ── 최대 환율 변동폭 ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">최대 환율 변동폭 계산</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">통화별 가중 표준편차 × Z₉₅=1.645</p>
          </div>
          {isMaster && (
            <div className="flex gap-2">
              <button onClick={handleAutoCalcStdDev} disabled={autoCalcState === 'loading'}
                className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700
                           text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50">
                {autoCalcState === 'loading' ? '⏳ ECOS 조회 중…' : '🔄 자동계산 (ECOS)'}
              </button>
              <button onClick={() => setEditingStd(!editingStd)}
                className="text-xs text-blue-600 border border-blue-200 dark:border-blue-700 px-2.5 py-1 rounded-lg dark:text-blue-400">
                {editingStd ? '취소' : '✏️ 수동 편집'}
              </button>
            </div>
          )}
        </div>

        {editingStd && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 space-y-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">※ 연간(√252) 수익률 표준편차 기준</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {FX_CURRENCY_DEFAULTS.map(c => (
                <div key={c.code} className="space-y-1">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300">{c.code}</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400">표준편차</label>
                      <input type="number" step="0.000001"
                        value={draftStd[c.stdKey] ?? c.defaultStd}
                        onChange={e => setDraftStd(p => ({ ...p, [c.stdKey]: Number(e.target.value) }))}
                        className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1
                                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400">가중치</label>
                      <input type="number" step="0.01" min="0" max="1"
                        value={draftStd[c.wgtKey] ?? c.defaultWgt}
                        onChange={e => setDraftStd(p => ({ ...p, [c.wgtKey]: Number(e.target.value) }))}
                        className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1
                                   bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={saveStd} disabled={saving}
              className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        {autoCalcMsg && (
          <div className={`mb-3 px-4 py-2.5 rounded-xl text-xs ${
            autoCalcState === 'done'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}>
            {autoCalcMsg}
            {autoCalcState === 'error' && (
              <p className="mt-1 text-red-500">
                GAS 스크립트 속성에 <code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">ECOS_API_KEY</code> 설정 필요.
                발급: <a href="https://ecos.bok.or.kr/api/#/" target="_blank" rel="noreferrer" className="underline">ecos.bok.or.kr/api</a>
              </p>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-400">
                <th className="text-left pb-2 pr-4">통화</th>
                <th className="text-right pb-2 pr-4">연간 표준편차</th>
                <th className="text-right pb-2 pr-2">
                  정책 가중치
                  <span className="text-gray-300 dark:text-gray-600 ml-1 font-normal">(계산 기준)</span>
                </th>
                <th className="text-right pb-2 pr-4">
                  실보유 비율
                  <span className="text-gray-300 dark:text-gray-600 ml-1 font-normal">(참고)</span>
                </th>
                <th className="text-right pb-2">가중 표준편차</th>
              </tr>
            </thead>
            <tbody>
              {currencyRowsWithActual.map(r => (
                <tr key={r.code} className="border-b border-gray-50 dark:border-gray-700/50">
                  <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-200">
                    {FX_META[r.code as FxCode].flag} {r.code}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {(r.std * 100).toFixed(4)}%
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {(r.wgt * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {r.actualWgt === null ? (
                      <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                    ) : (
                      <span className={r.wgtDrift
                        ? 'text-amber-500 dark:text-amber-400 font-medium'
                        : 'text-gray-500 dark:text-gray-400'}>
                        {(r.actualWgt * 100).toFixed(0)}%
                        {r.wgtDrift && (
                          <span className="ml-1" title="정책 가중치와 15%p 이상 괴리">⚠️</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">
                    {(r.wgt * r.std * 100).toFixed(4)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 dark:border-gray-600">
                <td colSpan={4} className="pt-2 text-xs text-gray-500 font-medium">전체 통화 변동율 (가중합)</td>
                <td className="pt-2 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-200">
                  {(weightedStdSum * 100).toFixed(4)}%
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="pt-1 pb-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
                  최대 환율 변동폭 (×Z<sub>95%</sub>={Z_95})
                </td>
                <td className="pt-1 pb-2 text-right tabular-nums font-bold text-blue-700 dark:text-blue-300 text-base">
                  {(maxRateChange * 100).toFixed(4)}%
                </td>
              </tr>
            </tfoot>
          </table>
          {!hasIndividualFxData && currentFxKrw > 0 && (
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              ※ 실보유 비율 — 운전자금 입력 시 통화별 잔액(USD/EUR/JPY 등)을 별도 입력해야 계산됩니다.
            </p>
          )}
        </div>
      </div>

      {/* ── 적정 외화보유한도 ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">적정 외화보유한도 계산</h3>
          {isMaster && (
            <button onClick={() => setEditingBase(!editingBase)}
              className="text-xs text-blue-600 border border-blue-200 dark:border-blue-700 px-2.5 py-1 rounded-lg dark:text-blue-400">
              {editingBase ? '취소' : '✏️ 파라미터 편집'}
            </button>
          )}
        </div>

        {editingBase && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 space-y-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">※ 자금정책위원회 의결에 따라 조정</p>

            {/* 전체 자금 총액 — 읽기 전용 자동계산 */}
            <div className="bg-white dark:bg-gray-700 rounded-lg px-3 py-2.5 border border-blue-200 dark:border-blue-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">전체 자금 총액 (자동계산)</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{fmtKRW(totalFund)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                운전 {fmtKRW(operatingCash)} + 운용 {fmtKRW(investCash)} + 국채 {fmtKRW(bondCash)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'fx_operating_profit', label: '사업계획 영업이익 (원)', step: 100_000_000 },
                { key: 'fx_interest_income',  label: '예상 이자수익 (원)',     step: 100_000_000 },
                { key: 'fx_risk_portion',     label: '위험포션 (0~1)',         step: 0.05 },
                { key: 'fx_target_min',       label: 'Target Band 하한 (%) ← 위원회 의결',  step: 0.1 },
                { key: 'fx_target_max',       label: 'Target Band 상한 (%) ← 위원회 의결',  step: 0.1 },
              ].map(({ key, label, step }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 dark:text-gray-400">{label}</label>
                  <input type="number" step={step}
                    value={draftBase[key as keyof typeof draftBase]}
                    onChange={e => setDraftBase(p => ({ ...p, [key]: Number(e.target.value) }))}
                    className="mt-0.5 w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5
                               bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              ))}
            </div>
            <button onClick={saveBase} disabled={saving}
              className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400">사업계획 영업이익</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(operatingProfit)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <p className="text-xs text-gray-400">예상 이자수익</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(interestIncome)}</p>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4 space-y-2.5 text-sm">
            <div className="flex justify-between items-start">
              <span className="text-gray-500 dark:text-gray-400 text-xs leading-relaxed">
                허용가능 최대손익 = ({fmtKRW(operatingProfit)} + {fmtKRW(interestIncome)}) × {riskPortion}
              </span>
              <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(maxAllowedLoss)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 dark:text-gray-400 text-xs">최대 환율 변동폭 (자동계산)</span>
              <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{(maxRateChange * 100).toFixed(4)}%</span>
            </div>
            <div className="h-px bg-gray-200 dark:bg-gray-600" />
            <div className="flex justify-between items-center">
              <span className="font-medium text-blue-700 dark:text-blue-300 text-xs">
                적정 외화보유한도 = 허용최대손익 ÷ 변동폭
              </span>
              <span className="font-bold text-blue-700 dark:text-blue-300 text-base tabular-nums">{fmtKRW(optimalFxLimit)}</span>
            </div>
            <div className="flex justify-between items-start text-xs">
              <div>
                <span className="text-gray-400">전체 자금 대비 비율</span>
                <div className="text-gray-300 dark:text-gray-600 mt-0.5">
                  운전 {fmtKRW(operatingCash)} + 운용 {fmtKRW(investCash)} + 국채 {fmtKRW(bondCash)} = {fmtKRW(totalFund)}
                </div>
              </div>
              <span className="font-bold text-blue-600 dark:text-blue-400">{optimalFxRatio.toFixed(2)}%</span>
            </div>
          </div>
          {isMaster && !editingBase && (
            <div className="pt-1">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>위험포션: <strong>{riskPortion.toFixed(2)}</strong></span>
                <span className="text-amber-600">위원회 의결 파라미터</span>
              </div>
              <input type="range" min="0.1" max="1.0" step="0.05" value={riskPortion}
                onChange={async e => await params.set('fx_risk_portion', Number(e.target.value), null, user?.label ?? '')}
                className="w-full accent-blue-600" />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>0.1 (보수적)</span><span>1.0 (공격적)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── AS-IS vs TO-BE ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">통화별 현황 (AS-IS vs TO-BE)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-400">
                <th className="text-left pb-2 pr-3">통화</th>
                <th className="text-right pb-2 pr-3">가중치</th>
                <th className="text-right pb-2 pr-3">현재잔액 (AS-IS)</th>
                <th className="text-right pb-2 pr-3">원화환산</th>
                <th className="text-right pb-2 pr-3">목표한도 (TO-BE)</th>
                <th className="text-right pb-2">초과/부족</th>
              </tr>
            </thead>
            <tbody>
              {currencyRows.filter(r => r.wgt > 0).map(r => {
                const bal      = fxBalances[r.code]
                const krwVal   = fx.toKRW(bal, r.code)
                const targetKrw = optimalFxLimit * r.wgt
                const diff     = krwVal - targetKrw
                return (
                  <tr key={r.code} className="border-b border-gray-50 dark:border-gray-700/50">
                    <td className="py-2.5 pr-3 font-medium text-gray-700 dark:text-gray-200">
                      {FX_META[r.code].flag} {r.code}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-500">{(r.wgt * 100).toFixed(0)}%</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNumber(bal, 0)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-blue-700 dark:text-blue-400">{fmtKRW(krwVal)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtKRW(targetKrw)}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className={`text-xs font-medium ${
                        diff > targetKrw * 0.05  ? 'text-red-500' :
                        diff < -targetKrw * 0.05 ? 'text-amber-500' : 'text-green-600'
                      }`}>
                        {diff >= 0 ? '+' : ''}{fmtKRW(diff)}
                        {diff > targetKrw * 0.05 ? ' ↑초과' : diff < -targetKrw * 0.05 ? ' ↓부족' : ' ✓'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-gray-200 dark:border-gray-600">
                <td colSpan={3} className="pt-2 text-xs text-gray-400 font-medium">합계</td>
                <td className="pt-2 text-right tabular-nums font-bold text-blue-800 dark:text-blue-300">{fmtKRW(currentFxKrw)}</td>
                <td className="pt-2 text-right tabular-nums font-bold text-gray-700 dark:text-gray-200">{fmtKRW(optimalFxLimit)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
