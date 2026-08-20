import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useFxLots } from '../hooks/useFxLots'
import { useFx } from '../hooks/useFx'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { usePolicyParams } from '../hooks/usePolicyParams'
import { useInvestments } from '../hooks/useInvestments'
import { fmtKRW } from '../lib/format'
import { summarizeRealizedPnl } from '../lib/fxTxnType'
import type { FxCode, FxTradeFill, FxLotConsumption } from '../types'
import { FxLedgerTab } from '../components/fx/FxLedgerTab'
import { FxOrdersTab } from '../components/fx/FxOrdersTab'
import { FxLotAdminTab } from '../components/fx/FxLotAdminTab'
import FxBandExceedPanel from '../components/fx/FxBandExceedPanel'

const CURRENCIES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

type TabKey = 'ledger' | 'orders' | 'lots' | 'pnl'
const TAB_LABEL: Record<TabKey, string> = {
  ledger: '📒 원장', orders: '📝 외화매도이력', lots: '⚙️ 데이터 등록', pnl: '📊 환차손익 요약',
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className={CARD}><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-lg font-bold text-gray-900 dark:text-slate-100">{value}</div></div>
}

/**
 * 외화 원장 — FIFO 재고(fx_lots)와 외화매매거래 워크플로우(fx_trade_history)를
 * 하나의 화면으로 통합한 페이지(세션26차 4일차, 옛 FxLedgerPage + FxTradeHistoryPage 통폐합).
 *
 * 통합 배경: 체결 등록 시 서버가 이미 FIFO 로트를 소진해 데이터는 연결돼 있었지만,
 * 화면이 두 메뉴로 나뉘어 있어 "재고 확인 → 매각 체결 → 잔액 재확인"에 페이지를 오가야
 * 했다. 이제 한 화면 안에서 탭만 전환하면 되고, 매각 지시 관리 탭에서 체결을 등록하면
 * refreshAll() 을 통해 원장 탭 잔액에 즉시 반영된다.
 *
 * 옛 /fx-trade-history 경로는 App.tsx 에서 이 페이지로 리다이렉트된다(?tab=orders).
 */
export default function FxLedgerPage() {
  const { company } = usePageCompany('/fx-ledger')
  const { user, canEdit, canDelete } = useAuth()
  const [searchParams] = useSearchParams()
  const [currency, setCurrency] = useState<FxCode>(() => {
    const c = searchParams.get('currency')
    return (CURRENCIES as readonly string[]).includes(c ?? '') ? c as FxCode : 'USD'
  })
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const t = searchParams.get('tab')
    return t === 'orders' || t === 'lots' || t === 'pnl' ? t : 'ledger'
  })

  const ledger = useFxLots(company, currency)
  const fx = useFx()
  // 계좌 대체 평가 방식 — 법인 정책. 미설정이면 원가승계(실현손익 0).
  const policyParams = usePolicyParams(company)
  const valuationMethod: 'carryover' | 'revalue' =
    policyParams.getText('fx_transfer_valuation') === 'revalue' ? 'revalue' : 'carryover'
  // A패턴: 법인 단위 전체 통화 자동 로드 — 이행 대기 배너(원장 탭)·환차손익 요약(전체 실적
  // 포함)·과거 매각 CSV 이관 관리(로트 설정 탭)가 공유한다.
  const trades = useFxTradeHistory(company)
  // 운용자금 — 외화 정기예금 정합성 점검용(활성 건만)
  const invest = useInvestments(true, company)
  const marketRate = fx.rates.find(row => row.code === currency)?.rate ?? 0

  const [fillsData, setFillsData] = useState<{
    fills: FxTradeFill[]
    consumptionsByFillId: Record<string, FxLotConsumption[]>
    consumptionsByLotId: Record<string, FxLotConsumption[]>
  }>({ fills: [], consumptionsByFillId: {}, consumptionsByLotId: {} })
  const [fillsLoading, setFillsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFillsLoading(true)
    void (async () => {
      const detail = await trades.fetchFillsByCurrency(company, currency)
      if (!cancelled) { setFillsData(detail); setFillsLoading(false) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, currency, refreshKey])

  const refreshAll = useCallback(() => {
    void ledger.refetch()
    void trades.load()
    setRefreshKey(k => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 이 법인·통화의 활성 외화 정기예금 — 원장 term_deposit 로트와의 정합성 점검·연결용.
  // ⚠ 두 장부가 서로를 참조하지 않아 따로 놀던 것을 잇는 지점이다(Phase 2).
  const termInvestments = useMemo(
    () => invest.data.filter(i => i.active && i.currency === currency && i.product === '정기예금'),
    [invest.data, currency])

  const isPending = (s: string) => s === '발의' || s === '승인' || s === '부분체결'
  const pendingOrders = trades.data.filter(r => r.currency === currency && isPending(r.status))
  // 외화매도이력 탭의 "이행 대기" 고정 패널은 통화 탭과 무관하게 법인 전체를 본다 —
  // 다른 통화 지시가 통화 탭 뒤에 숨어 기한을 넘기는 일이 없어야 한다.
  const allPendingOrders = trades.data.filter(r => isPending(r.status))
  const initialOrderId = searchParams.get('order')

  // 환차손익 요약 — 법인 전체 통화가 섞이던 기존 버그 수정, 선택된 통화만 집계
  const completedForPnl = trades.data.filter(r => r.currency === currency && (r.status === '완료' || r.status === '부분체결'))
  const pnlValues = completedForPnl.map(r => r.completed_pnl ?? r.fx_pnl ?? 0)
  // 거래 유형별 실현손익 — FIFO 소진 내역 기준(개시 이후). 위 카드(거래 이력 기준)와 축이 다르다.
  const txnPnl = summarizeRealizedPnl(Object.values(fillsData.consumptionsByLotId).flat())
  const pnlSummary = {
    gain: pnlValues.filter(v => v > 0).reduce((a, b) => a + b, 0),
    loss: pnlValues.filter(v => v < 0).reduce((a, b) => a + b, 0),
    net: pnlValues.reduce((a, b) => a + b, 0),
  }

  return <div className="space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">외화거래명세</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">{company} · 재고(FIFO)와 매각 지시 워크플로우를 한 화면에서 관리합니다.</p>
      </div>
    </div>
    <div className="flex gap-2">{CURRENCIES.map(code => <button key={code} onClick={() => setCurrency(code)}
      className={`rounded px-3 py-1.5 text-xs font-semibold ${currency === code ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{code}</button>)}</div>

    {ledger.error && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{ledger.error.includes('does not exist') || ledger.error.includes('schema cache') ? '원장 스키마 적용 전입니다. docs/db/fx_lot_ledger.sql을 Supabase SQL Editor에서 검토·실행하세요.' : ledger.error}</div>}
    <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="잔여 외화" value={ledger.totalAmount.toLocaleString()} />
      <Stat label="현재 환전 가능" value={ledger.availableAmount.toLocaleString()} />
      <Stat label="만기 전 잠금" value={ledger.lockedAmount.toLocaleString()} />
      <Stat label="예상 만기이자" value={ledger.expectedInterestFx.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
      <Stat label="FIFO 잔존 장부환율" value={ledger.bookRate ? `${ledger.bookRate.toFixed(1)}원` : '—'} />
      <Stat label="현재 시장환율" value={marketRate ? `${marketRate.toFixed(1)}원` : '조회 전'} />
      <Stat label="미실현 평가손익" value={ledger.bookRate && marketRate ? fmtKRW(ledger.totalAmount * (marketRate - ledger.bookRate)) : '—'} />
    </div>

    <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
      {(Object.keys(TAB_LABEL) as TabKey[]).map(key =>
        <button key={key} onClick={() => setActiveTab(key)}
          className={`border-b-2 px-3 py-2 text-sm ${activeTab === key ? 'border-blue-600 font-semibold text-blue-600' : 'border-transparent text-gray-500'}`}>
          {TAB_LABEL[key]}
        </button>)}
    </div>

    {activeTab === 'ledger' && (
      <FxLedgerTab
        company={company}
        lots={ledger.lots} consumptionsByLotId={fillsData.consumptionsByLotId}
        fills={fillsData.fills}
        loading={ledger.loading || fillsLoading} currency={currency} totalAmount={ledger.totalAmount}
        pendingOrders={pendingOrders}
        onUpdateLot={ledger.updateLot} onDeleteLot={ledger.deleteLot}
        onReconcileInflow={(dailyId, amount, rate, date) => ledger.reconcileDailyInflow({ dailyId, amount, rate, date, userCode: user?.code ?? 'unknown' })}
        onReconcileOutflow={(dailyId, amount, rate, date) => ledger.reconcileDailyOutflow({ dailyId, amount, rate, date, userCode: user?.code ?? 'unknown' })}
        onGotoOrders={() => setActiveTab('orders')} onChanged={refreshAll}
      />
    )}
    {activeTab === 'orders' && (
      <div className="space-y-4">
        {/* 실무 담당자용 발의 경로 — 자금정책 메뉴 권한이 없어도 상한 초과를 인지하고
            발의할 수 있어야 한다(세션26차 11일차). 실행(승인·체결)은 아래 목록에서. */}
        <FxBandExceedPanel company={company} onProposed={refreshAll} />
        <FxOrdersTab company={company} currency={currency} onChanged={refreshAll}
          pendingOrders={allPendingOrders} initialOrderId={initialOrderId} />
      </div>
    )}
    {activeTab === 'lots' && (
      <FxLotAdminTab
        ledger={ledger} trades={trades} company={company} currency={currency}
        valuationMethod={valuationMethod} termInvestments={termInvestments}
        userCode={user?.code ?? 'unknown'}
        canEdit={canEdit()} canDelete={canDelete()} onChanged={refreshAll}
      />
    )}
    {activeTab === 'pnl' && (
      <>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="누적 실현이익" value={fmtKRW(pnlSummary.gain)} />
          <Stat label="누적 실현손실" value={fmtKRW(pnlSummary.loss)} />
          <Stat label="순 실현손익" value={fmtKRW(pnlSummary.net)} />
          <Stat label={`${currency} 미실현손익`} value={ledger.bookRate && marketRate ? fmtKRW(ledger.totalAmount * (marketRate - ledger.bookRate)) : '—'} />
        </div>
        {/* 거래 유형별 분리 (세션26차 Phase 3) — 매각과 대외 지급을 합치면 매각 실적이 부풀려진다.
            위 카드는 매각 지시(fx_trade_history) 기준이라 개시 이전 CSV 실적까지 포함하고,
            아래 표는 FIFO 소진 내역(fx_lot_consumptions) 기준이라 개시 이후만 잡힌다 — 축이 다르다. */}
        <div className={CARD}>
          <div className="text-sm font-semibold">거래 유형별 실현손익 <span className="text-xs font-normal text-gray-400">· FIFO 소진 내역 기준(개시 이후)</span></div>
          <table className="mt-2 w-full max-w-md text-xs tabular-nums">
            <tbody className="text-gray-700 dark:text-slate-300">
              {([
                ['매각(환전)', txnPnl.sale, '환차손익 정본 — 원화로 환전한 실적'],
                ['대외 지급',   txnPnl.payment, '매입대금·수수료 등 — 매각 실적이 아님'],
                ['계좌 대체',   txnPnl.transfer, '원가승계면 0, 재평가 정책일 때만 발생'],
              ] as const).map(([label, v, hint]) => (
                <tr key={label} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-1.5 font-medium whitespace-nowrap">{label}</td>
                  <td className={`py-1.5 text-right ${v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {v === 0 ? '—' : `${v >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(v))}`}
                  </td>
                  <td className="py-1.5 pl-3 text-[11px] text-gray-400">{hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={CARD}>
          <div className="text-sm font-semibold">읽는 법</div>
          <div className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-slate-300">개시 이전 매각은 확정 실적만 복원하며 현재 로트를 다시 차감하지 않습니다. 개시 이후 거래부터 FIFO 소진 명세와 연결됩니다(① 원장 탭에서 확인). 수수료가 없는 CSV 이력은 수수료 차감 전 손익입니다.</div>
        </div>
      </>
    )}
  </div>
}
