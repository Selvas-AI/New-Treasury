import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtKRW, calcDday, calcBondValue } from '../../lib/format'
import { toKRWAmount } from '../../lib/treasuryCalc'
import { useFx } from '../../hooks/useFx'
import type { FlowItemKey } from './WaterfallCard'
import type { KpiData } from '../../hooks/useDashboard'
import type { DailyRecord, InvestmentRecord, LoanRecord } from '../../types'

interface EquityItem {
  name: string
  available: '가용' | '불가용'
  total_value: number
  acquisition_cost?: number
  returnRate?: number | null
}

interface Props {
  itemKey:       FlowItemKey | null
  kpi:           KpiData
  fxKrw?:        number  // 운전+운용 외화 KRW 합계 (대시보드에서 합산해서 전달)
  latestDaily:   DailyRecord | null
  latestInvests: InvestmentRecord[]
  loans:         LoanRecord[]
  equities:      EquityItem[]
  company:       string
  onClose:       () => void
}

const TITLES: Record<FlowItemKey, string> = {
  operating:   '운전자금 상세',
  invest:      '운용자금 상세',
  fx:          '외화 상세',
  loan:        '차입금 상세',
  net:         '순현금 포지션',
  unavailable: '불가용 자산',
  available:   '가용자금 합계',
  asset:       '자산 구성 상세',
  equity_avail: '지분(가용) 상세',
}

export default function FlowDetailDrawer({ itemKey, kpi, fxKrw: fxKrwProp, latestDaily, latestInvests, loans, equities, company, onClose }: Props) {
  const navigate = useNavigate()
  const fx = useFx()

  // 팝업 열릴 때 환율 즉시 로드 (자체 useFx 인스턴스라 별도 fetch 필요)
  useEffect(() => { void fx.fetchRates() }, [fx.fetchRates])

  // ESC 키로 닫기 (접근성)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 외화 → 원화 환산 (SSOT — useDashboard.kpi 계산과 동일 함수)
  const toKRWAmt = (amount: number, currency: string): number =>
    toKRWAmount(amount, currency, fx.toKRW)

  if (!itemKey) return null

  const title = TITLES[itemKey]

  return (
    <>
      {/* 배경 딤 */}
      <div
        className="fixed inset-0 z-40 bg-black/10 dark:bg-black/30"
        onClick={onClose}
      />

      {/* 드로어 패널 */}
      <div style={{ animation: 'fadeInScale 0.18s ease-out both' }} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm max-h-[80vh] bg-white dark:bg-slate-800 rounded-xl shadow-xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700">
        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="overflow-y-auto flex-1 min-h-0 px-4 py-3">
          {itemKey === 'operating'  && <OperatingDetail daily={latestDaily} kpi={kpi} />}
          {itemKey === 'invest'     && <InvestDetail items={latestInvests.filter(i => i.product !== '국채' && i.available === '가용')} kpi={kpi} toKRWAmt={toKRWAmt} />}
          {itemKey === 'loan'       && <LoanDetail loans={loans.filter(l => l.active)} kpi={kpi} toKRWAmt={toKRWAmt} />}
          {itemKey === 'fx'         && <FxDetail daily={latestDaily} latestInvests={latestInvests} kpi={kpi} />}
          {itemKey === 'net'        && <NetDetail kpi={kpi} />}
          {itemKey === 'unavailable' && <UnavailableDetail kpi={kpi} latestInvests={latestInvests} equities={equities} />}
          {itemKey === 'available'  && <AvailableDetail kpi={kpi} daily={latestDaily} latestInvests={latestInvests} equities={equities} toKRWAmt={toKRWAmt} />}
          {itemKey === 'asset'      && <AssetDetail kpi={kpi} fxKrw={fxKrwProp ?? (latestDaily?.fx_krw ?? 0)} />}
          {itemKey === 'equity_avail' && <EquityAvailDetail equities={equities.filter(e => e.available === '가용')} total={kpi.equityAvail} />}
        </div>

        {/* 하단 바로가기 (D5: 항목별 딥링크 맵으로 표준화 + fx 추가) */}
        {(() => {
          const SHORTCUTS: Partial<Record<FlowItemKey, { path: string; label: string }>> = {
            operating:    { path: `/input/${company}`,  label: '운전자금 입력 →' },
            available:    { path: `/input/${company}`,  label: '운전자금 입력 →' },
            invest:       { path: `/invest/${company}`, label: '운용자금 관리 →' },
            loan:         { path: `/loans/${company}`,  label: '차입금 관리 →' },
            equity_avail: { path: `/equity/${company}`, label: '지분/장기투자 →' },
            fx:           { path: `/fx`,                label: '환율 현황 →' },
          }
          const sc = itemKey ? SHORTCUTS[itemKey] : undefined
          return sc ? (
            <div className="shrink-0 px-4 py-3 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={() => { onClose(); navigate(sc.path) }}
                className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline text-center py-1"
              >
                {sc.label}
              </button>
            </div>
          ) : null
        })()}
      </div>
    </>
  )
}

// ── 운전자금 상세 ────────────────────────────────────────────
function OperatingDetail({ daily, kpi }: { daily: DailyRecord | null; kpi: KpiData }) {
  if (!daily) return <p className="text-xs text-gray-400 py-4 text-center">오늘 운전자금 데이터가 없습니다</p>
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-700">
      {[
        { label: '보통예금 / CMA', value: daily.krw_demand },
        { label: '국책자금',        value: daily.krw_govt  },
        { label: '증권 예수금',     value: daily.krw_mmda  },
        { label: '외화 (원화환산)', value: daily.fx_krw    },
      ].map(r => (
        <div key={r.label} className="flex justify-between items-center py-2">
          <span className="text-[11px] text-gray-400">{r.label}</span>
          <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtKRW(r.value)}</span>
        </div>
      ))}
      <div className="flex justify-between items-center py-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">합계</span>
        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">{fmtKRW(kpi.operatingCash)}</span>
      </div>
    </div>
  )
}

// ── 운용자금 상세 (대시보드 "가용 운용" 항목과 동일하게 가용분만 표시) ──
function InvestDetail({ items, kpi, toKRWAmt }: {
  items: InvestmentRecord[]
  kpi: KpiData
  toKRWAmt: (amount: number, currency: string) => number
}) {
  if (items.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">가용 운용자금이 없습니다</p>
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-700">
      {items.map(inv => {
        const krw  = toKRWAmt(inv.amount || 0, inv.currency || 'KRW')
        const isFx = inv.currency && inv.currency !== 'KRW'
        return (
          <div key={inv.id} className="flex justify-between items-center py-2">
            <span className="text-[11px] text-gray-400 truncate mr-2">
              {inv.bank}
              {isFx && <span className="ml-1 text-[10px] text-amber-500">{inv.currency}</span>}
            </span>
            <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200 shrink-0">{fmtKRW(krw)}</span>
          </div>
        )
      })}
      <div className="flex justify-between items-center py-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">합계 (가용)</span>
        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtKRW(kpi.investCash)}</span>
      </div>
    </div>
  )
}

// ── 차입금 상세 ──────────────────────────────────────────────
function LoanDetail({ loans, kpi, toKRWAmt }: {
  loans: LoanRecord[]
  kpi: KpiData
  toKRWAmt: (amount: number, currency: string) => number
}) {
  if (loans.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">활성 차입금이 없습니다</p>
  return (
    <div>
      {loans.map(loan => {
        const dday = calcDday(loan.maturity)
        const krw  = toKRWAmt(loan.amount, loan.currency || 'KRW')
        return (
          <div key={loan.id} className="px-2 py-2.5 rounded-lg border border-transparent hover:bg-gray-50 dark:hover:bg-slate-700/50">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{loan.lender}</span>
              <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtKRW(krw)}</span>
            </div>
            <div className="flex justify-between items-center mt-0.5">
              <span className="text-[10px] text-gray-400">{loan.rate}% · {loan.maturity}</span>
              <span className={`text-[10px] font-semibold ${dday <= 30 ? 'text-red-500' : dday <= 90 ? 'text-amber-500' : 'text-gray-400'}`}>D-{dday}</span>
            </div>
          </div>
        )
      })}
      <div className="flex justify-between items-center border-t border-gray-100 dark:border-slate-700 pt-2 mt-1 px-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">합계</span>
        <span className="text-sm font-bold text-red-500 tabular-nums">{fmtKRW(kpi.totalLoan)}</span>
      </div>
    </div>
  )
}

// ── 지분(가용) 상세 ──────────────────────────────────────────
function EquityAvailDetail({ equities, total }: { equities: EquityItem[]; total: number }) {
  if (equities.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">가용 지분이 없습니다</p>
  return (
    <div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">상장 지분(가용) — 순현금 미포함, 참고용</p>
      <div className="divide-y divide-gray-50 dark:divide-slate-700">
        {equities.map((e, i) => (
          <div key={i} className="flex justify-between items-center py-2 gap-2">
            <span className="text-[11px] text-gray-500 dark:text-slate-100 truncate">{e.name}</span>
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtKRW(e.total_value)}</span>
              {e.returnRate != null && (
                <span className={`text-[10px] tabular-nums font-medium ${e.returnRate >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                  {e.returnRate >= 0 ? '+' : ''}{e.returnRate.toFixed(1)}%
                </span>
              )}
            </span>
          </div>
        ))}
        <div className="flex justify-between items-center py-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">합계</span>
          <span className="text-sm font-bold text-violet-600 dark:text-violet-400 tabular-nums">{fmtKRW(total)}</span>
        </div>
      </div>
    </div>
  )
}

// ── 외화 상세 (운전자금 외화 + 가용 운용자금 외화 — 대시보드 "외화(환산)"과 동일 범위) ──
function FxDetail({ daily, latestInvests, kpi }: {
  daily: DailyRecord | null
  latestInvests: InvestmentRecord[]
  kpi: KpiData
}) {
  const CODES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY'] as const
  const operatingNative: Record<string, number> = {
    USD: daily?.fx_usd ?? 0, EUR: daily?.fx_eur ?? 0, JPY: daily?.fx_jpy ?? 0,
    GBP: daily?.fx_gbp ?? 0, CNY: daily?.fx_cny ?? 0,
  }
  const investNative: Record<string, number> = {}
  latestInvests
    .filter(i => i.product !== '국채' && i.available === '가용' && i.currency && i.currency !== 'KRW')
    .forEach(i => { investNative[i.currency!] = (investNative[i.currency!] ?? 0) + (i.amount || 0) })

  const rows = CODES.map(code => ({
    code,
    opNative:  operatingNative[code] ?? 0,
    invNative: investNative[code] ?? 0,
  })).filter(r => r.opNative > 0 || r.invNative > 0)

  // 원화환산 합계 = 운전자금(저장값 fx_krw, SSOT) + 가용 운용자금 외화(현재 환율, kpi.investFxKrw)
  const totalKrw = (daily?.fx_krw ?? 0) + kpi.investFxKrw

  if (rows.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">외화 보유 없음</p>
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-700">
      {rows.map(r => (
        <div key={r.code} className="py-2">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-gray-400">{r.code}</span>
            <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200">
              {(r.opNative + r.invNative).toLocaleString()}
            </span>
          </div>
          {r.invNative > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              운전 {r.opNative.toLocaleString()} + 운용 {r.invNative.toLocaleString()}
            </p>
          )}
        </div>
      ))}
      <div className="flex justify-between items-center py-2">
        <span className="text-xs text-gray-400">원화환산 합계</span>
        <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmtKRW(totalKrw)}</span>
      </div>
    </div>
  )
}

// ── 순현금 포지션 ────────────────────────────────────────────
function NetDetail({ kpi }: { kpi: KpiData }) {
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-700">
      {[
        { label: '가용자금 합계', value: kpi.availableCash, color: 'text-blue-600 dark:text-blue-400' },
        { label: '차입금 합계',   value: -kpi.totalLoan,    color: 'text-red-500' },
      ].map(r => (
        <div key={r.label} className="flex justify-between items-center py-2">
          <span className="text-[11px] text-gray-400">{r.label}</span>
          <span className={`text-xs tabular-nums font-semibold ${r.color}`}>
            {r.value >= 0 ? '' : '-'}{fmtKRW(Math.abs(r.value))}
          </span>
        </div>
      ))}
      <div className="flex justify-between items-center py-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">순현금</span>
        <span className={`text-sm font-bold tabular-nums ${kpi.netCashPosition >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
          {kpi.netCashPosition >= 0 ? '+' : ''}{fmtKRW(kpi.netCashPosition)}
        </span>
      </div>
    </div>
  )
}

// ── 가용자금 합계 상세 ───────────────────────────────────────
function AvailableDetail({ kpi, daily, latestInvests, equities, toKRWAmt }: {
  kpi: KpiData
  daily: DailyRecord | null
  latestInvests: InvestmentRecord[]
  equities: EquityItem[]
  toKRWAmt: (amount: number, currency: string) => number
}) {
  const availInvest  = latestInvests.filter(i => i.product !== '국채' && i.available === '가용')
  const availBond    = latestInvests.filter(i => i.product === '국채'  && i.available === '가용')
  const availEquity  = equities.filter(e => e.available === '가용')

  return (
    <div className="space-y-3">
      {/* 운전자금 */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">운전자금</p>
        <div className="divide-y divide-gray-50 dark:divide-slate-700">
          {[
            { label: '보통예금 / CMA', value: daily?.krw_demand ?? 0 },
            { label: '국책자금',        value: daily?.krw_govt  ?? 0 },
            { label: '증권 예수금',     value: daily?.krw_mmda  ?? 0 },
            { label: '외화 (원화환산)', value: daily?.fx_krw    ?? 0 },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-1.5">
              <span className="text-[11px] text-gray-400">{r.label}</span>
              <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200">{fmtKRW(r.value)}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 가용 운용자금 */}
      {(availInvest.length > 0 || availBond.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">가용 운용자금</p>
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {[...availInvest, ...availBond].map(i => {
              const displayVal = i.product === '국채' && i.bondQty && i.bondPrice
                ? calcBondValue(i.bondQty, i.bondPrice)
                : toKRWAmt(i.amount || 0, i.currency || 'KRW')
              const isFx = i.product !== '국채' && i.currency && i.currency !== 'KRW'
              return (
                <div key={i.id} className="flex justify-between items-center py-1.5">
                  <span className="text-[11px] text-gray-400 truncate mr-2">
                    {i.product === '국채' ? (i.bondName ?? i.bank) : i.bank}
                    {isFx && <span className="ml-1 text-[10px] text-amber-500">{i.currency}</span>}
                  </span>
                  <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200 shrink-0">{fmtKRW(displayVal)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* 가용 지분/장기투자 */}
      {availEquity.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">가용 지분/장기투자</p>
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {availEquity.map(e => (
              <div key={e.name} className="flex justify-between items-center py-1.5">
                <span className="text-[11px] text-gray-400 truncate mr-2">{e.name}</span>
                <span className="text-xs tabular-nums font-semibold text-gray-700 dark:text-gray-200 shrink-0">{fmtKRW(e.total_value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-between items-center border-t border-gray-200 dark:border-slate-600 pt-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">가용자금 합계</span>
        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">{fmtKRW(kpi.availableCash)}</span>
      </div>
    </div>
  )
}

// ── 자산 구성 상세 ───────────────────────────────────────────
function AssetDetail({ kpi, fxKrw }: {
  kpi: KpiData
  fxKrw: number
}) {
  const investTotal = kpi.investCash + kpi.bondCash
  const totalAssets = kpi.availableCash + kpi.unavailableAssets || 1
  const pctOf = (v: number) => Math.round((v / totalAssets) * 100)
  const fxRatio  = kpi.availableCash > 0 ? Math.round((fxKrw / kpi.availableCash) * 100) : 0
  const krwRatio = 100 - fxRatio

  return (
    <div className="space-y-3">
      <div className="divide-y divide-gray-50 dark:divide-slate-700">
        {[
          { label: '운전자금',  value: kpi.operatingCash,    color: 'text-blue-600 dark:text-blue-400',    pct: pctOf(kpi.operatingCash) },
          { label: '가용운용',  value: investTotal,           color: 'text-emerald-600 dark:text-emerald-400', pct: pctOf(investTotal) },
          ...(kpi.unavailableAssets > 0
            ? [{ label: '불가용자산', value: kpi.unavailableAssets, color: 'text-amber-600 dark:text-amber-400', pct: pctOf(kpi.unavailableAssets) }]
            : []),
        ].map(r => (
          <div key={r.label} className="flex justify-between items-center py-2">
            <span className="text-[11px] text-gray-500 dark:text-slate-300">{r.label}</span>
            <div className="text-right">
              <span className={`text-xs tabular-nums font-semibold ${r.color}`}>{fmtKRW(r.value)}</span>
              <span className="text-[10px] text-gray-400 ml-2">({r.pct}%)</span>
            </div>
          </div>
        ))}
      </div>
      {fxKrw > 0 && kpi.availableCash > 0 && (
        <div className="pt-1">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">원화/외화 비율 (가용)</p>
          <div className="h-2 rounded-full overflow-hidden flex mb-1">
            <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${krwRatio}%` }} />
            <div className="bg-amber-400 h-full transition-all duration-500" style={{ width: `${fxRatio}%` }} />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">원화 {krwRatio}% · {fmtKRW(kpi.availableCash - fxKrw)}</span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">외화 {fxRatio}% · {fmtKRW(fxKrw)}</span>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center border-t border-gray-200 dark:border-slate-600 pt-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">총 자산</span>
        <span className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums">{fmtKRW(totalAssets)}</span>
      </div>
    </div>
  )
}

// ── 불가용 자산 ──────────────────────────────────────────────
function UnavailableDetail({ kpi, latestInvests, equities }: {
  kpi: KpiData
  latestInvests: InvestmentRecord[]
  equities: EquityItem[]
}) {
  const unavailInvests = latestInvests.filter(i => i.product !== '국채' && i.available === '불가용')
  const unavailBonds   = latestInvests.filter(i => i.product === '국채'  && i.available === '불가용')
  const unavailEquity  = equities.filter(e => e.available === '불가용')

  const sections: { label: string; rows: { name: string; value: number; sub?: string }[] }[] = []

  if (unavailEquity.length > 0) {
    sections.push({
      label: '지분 (비상장 · 매각제한)',
      rows: unavailEquity.map(e => ({
        name: e.name,
        value: e.total_value || 0,
        sub: e.returnRate != null
          ? `취득 ${fmtKRW(e.acquisition_cost ?? 0)} · ${e.returnRate >= 0 ? '+' : ''}${e.returnRate.toFixed(1)}%`
          : undefined,
      })),
    })
  }

  if (unavailInvests.length > 0) {
    sections.push({
      label: '운용자금 (불가용)',
      rows: unavailInvests.map(i => ({ name: i.bank, value: i.amount || 0 })),
    })
  }

  if (unavailBonds.length > 0) {
    sections.push({
      label: '국채 (불가용)',
      rows: unavailBonds.map(b => ({
        name: b.bondName ?? b.bank,
        value: b.bondQty && b.bondPrice ? calcBondValue(b.bondQty, b.bondPrice) : (b.amount || 0),
      })),
    })
  }

  if (sections.length === 0) {
    return (
      <div className="py-4 text-center space-y-2">
        <p className="text-2xl font-bold text-amber-600 tabular-nums">{fmtKRW(kpi.unavailableAssets)}</p>
        <p className="text-xs text-gray-400">상세 내역이 없습니다</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {sections.map(sec => (
        <div key={sec.label}>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{sec.label}</p>
          <div className="divide-y divide-gray-50 dark:divide-slate-700">
            {sec.rows.map(row => (
              <div key={row.name} className="py-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-gray-600 dark:text-slate-100 truncate mr-2">{row.name}</span>
                  <span className="text-xs tabular-nums font-semibold text-amber-600 dark:text-amber-400 shrink-0">{fmtKRW(row.value)}</span>
                </div>
                {row.sub && <p className="text-[10px] text-gray-400 mt-0.5">{row.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-between items-center border-t border-gray-100 dark:border-slate-700 pt-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">합계</span>
        <span className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmtKRW(kpi.unavailableAssets)}</span>
      </div>
    </div>
  )
}

