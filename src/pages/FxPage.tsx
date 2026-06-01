import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDaily } from '../hooks/useDaily'
import { useFx } from '../hooks/useFx'
import { fmtKRW, fmtNumber } from '../lib/format'
import type { FxCode } from '../types'

const FX_META: Record<FxCode, { name: string; flag: string; unit: string }> = {
  USD: { name: '미국 달러',   flag: '🇺🇸', unit: '1 USD' },
  EUR: { name: '유로',        flag: '🇪🇺', unit: '1 EUR' },
  JPY: { name: '일본 엔',     flag: '🇯🇵', unit: '100 JPY' },
  GBP: { name: '영국 파운드', flag: '🇬🇧', unit: '1 GBP' },
  CNY: { name: '중국 위안',   flag: '🇨🇳', unit: '1 CNY' },
}

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

export default function FxPage() {
  const { currency: paramCurrency } = useParams<{ currency?: string }>()
  useAuth()
  const daily = useDaily()
  const fx    = useFx()

  const [highlight, setHighlight] = useState<FxCode | null>(null)
  const [calcMode, setCalcMode]   = useState<'krw' | 'fx'>('fx')
  const [calcInput, setCalcInput] = useState('')
  const [calcCurrency, setCalcCurrency] = useState<FxCode>('USD')

  // 딥링크로 통화 진입 시 강조
  useEffect(() => {
    const upper = paramCurrency?.toUpperCase() as FxCode
    if (upper && FX_CODES.includes(upper)) {
      setHighlight(upper)
      setCalcCurrency(upper)
    }
  }, [paramCurrency])

  // 환율 자동 로드
  useEffect(() => { void fx.fetchRates() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // 최신 운전자금 외화 잔고
  const latestDaily = useMemo(() => daily.data[0] ?? null, [daily.data])

  const fxBalances: Record<FxCode, number> = {
    USD: latestDaily?.fx_usd ?? 0,
    EUR: latestDaily?.fx_eur ?? 0,
    JPY: latestDaily?.fx_jpy ?? 0,
    GBP: latestDaily?.fx_gbp ?? 0,
    CNY: latestDaily?.fx_cny ?? 0,
  }

  // 환산기 계산
  const calcResult = useMemo(() => {
    const v = Number(calcInput) || 0
    if (!v) return null
    if (calcMode === 'fx') {
      // 외화 → 원화
      return fx.toKRW(v, calcCurrency)
    } else {
      // 원화 → 외화
      const rate = fx.rates.find(r => r.code === calcCurrency)
      if (!rate || !rate.rate) return null
      return v / (rate.rate / rate.unit)
    }
  }, [calcInput, calcMode, calcCurrency, fx])

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">환율 현황</h2>
        <button
          onClick={() => void fx.fetchRates()}
          disabled={fx.loading}
          className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
          {fx.loading ? '조회 중...' : '🔄 환율 갱신'}
        </button>
      </div>

      {fx.error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          ⚠️ {fx.error} — GAS API URL이 설정되지 않았거나 연결할 수 없습니다.
        </div>
      )}

      {/* 환율 카드 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {FX_CODES.map(code => {
          const meta = FX_META[code]
          const rate = fx.rates.find(r => r.code === code)
          const balance = fxBalances[code]
          const krwVal  = fx.toKRW(balance, code)
          const isHL    = highlight === code

          return (
            <button
              key={code}
              onClick={() => setHighlight(isHL ? null : code)}
              className={`rounded-xl border p-4 text-left transition-all ${
                isHL
                  ? 'border-blue-400 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
              }`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xl">{meta.flag}</span>
                <span className="text-xs font-bold text-gray-700">{code}</span>
              </div>
              <p className="text-xs text-gray-400 mb-0.5">{meta.unit}</p>
              <p className="text-lg font-bold text-gray-800">
                {rate ? `₩${fmtNumber(rate.rate)}` : '—'}
              </p>
              {balance > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400">보유잔고</p>
                  <p className="text-xs font-medium text-gray-700">
                    {fmtNumber(balance, 2)} {code}
                  </p>
                  <p className="text-xs text-blue-600 font-medium">{fmtKRW(krwVal)}</p>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 외화 잔고 요약 */}
      {latestDaily && (
        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-600">외화 잔고 현황</h3>
            <span className="text-xs text-gray-400">기준: {latestDaily.date}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['통화', '보유잔고', '환율', '원화환산', '비중'].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 font-medium pb-2 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FX_CODES.filter(c => fxBalances[c] > 0).map(code => {
                  const rate  = fx.rates.find(r => r.code === code)
                  const krwVal = fx.toKRW(fxBalances[code], code)
                  const totalFxKrw = latestDaily.fx_krw || 1
                  const pct  = totalFxKrw > 0 ? (krwVal / totalFxKrw) * 100 : 0

                  return (
                    <tr key={code} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span>{FX_META[code].flag}</span>
                          <span className="font-medium text-gray-800">{code}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-gray-700">
                        {fmtNumber(fxBalances[code], 2)}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-gray-500">
                        {rate ? `₩${fmtNumber(rate.rate)}` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums font-medium text-blue-700">
                        {fmtKRW(krwVal)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {/* 합계 행 */}
                <tr className="border-t border-gray-200">
                  <td colSpan={3} className="pt-2.5 text-xs text-gray-400 font-medium">합계</td>
                  <td className="pt-2.5 tabular-nums font-bold text-blue-800">
                    {fmtKRW(latestDaily.fx_krw)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 환산 계산기 */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">환산 계산기</h3>
        <div className="flex flex-wrap gap-3 items-end">
          {/* 모드 선택 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { key: 'fx',  label: '외화 → 원화' },
              { key: 'krw', label: '원화 → 외화' },
            ].map(m => (
              <button key={m.key}
                onClick={() => { setCalcMode(m.key as 'fx' | 'krw'); setCalcInput('') }}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  calcMode === m.key
                    ? 'bg-white text-blue-700 font-semibold shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                {m.label}
              </button>
            ))}
          </div>

          {/* 통화 선택 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">통화</label>
            <select
              value={calcCurrency}
              onChange={e => setCalcCurrency(e.target.value as FxCode)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {FX_CODES.map(c => (
                <option key={c} value={c}>{FX_META[c].flag} {c}</option>
              ))}
            </select>
          </div>

          {/* 금액 입력 */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-gray-400 mb-1">
              {calcMode === 'fx' ? `${calcCurrency} 금액` : '원화 금액 (원)'}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={calcInput}
              onChange={e => setCalcInput(e.target.value)}
              placeholder="0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* 결과 */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-gray-400 mb-1">
              {calcMode === 'fx' ? '원화 환산' : `${calcCurrency} 환산`}
            </label>
            <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-semibold text-blue-800 text-right min-h-[38px]">
              {calcResult !== null
                ? calcMode === 'fx'
                  ? fmtKRW(calcResult)
                  : `${fmtNumber(calcResult, 4)} ${calcCurrency}`
                : '—'
              }
            </div>
          </div>
        </div>

        {/* 적용 환율 표시 */}
        {fx.rates.length > 0 && (
          <p className="text-xs text-gray-400 mt-3">
            적용 환율: {FX_META[calcCurrency].unit} = ₩{fmtNumber(
              fx.rates.find(r => r.code === calcCurrency)?.rate ?? 0
            )} (출처: 하나은행 기준)
          </p>
        )}
      </div>
    </div>
  )
}
