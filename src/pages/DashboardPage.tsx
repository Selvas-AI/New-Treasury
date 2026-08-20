import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useDashboard } from '../hooks/useDashboard'
import { useLoans } from '../hooks/useLoans'
import { useInvestments } from '../hooks/useInvestments'
import { usePolicyDashboard } from '../hooks/usePolicyDashboard'
import { usePolicyParams } from '../hooks/usePolicyParams'
import { usePolicyDecisionsByCompany } from '../hooks/usePolicyDecisions'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { checkDecisionRule, checkFx } from '../lib/policyChecks'
import { readAllRegimeSnapshots, pendingDays } from '../lib/fxRegimeSnapshot'
import { REGIME_CURRENCIES } from '../lib/fxRegimeInputs'
import { orderTypeLabel } from '../lib/fxOrderType'
import { bizDaysBetween, todayStr } from '../lib/bizDay'
import { makeIssueKey } from '../hooks/useIssues'

import { fmtKRW } from '../lib/format'
import KpiCard from '../components/dashboard/KpiCard'
import WaterfallCard from '../components/dashboard/WaterfallCard'
import AssetCompositionCard from '../components/dashboard/AssetCompositionCard'
import FlowDetailDrawer from '../components/dashboard/FlowDetailDrawer'
import IssueDrawer from '../components/dashboard/IssueDrawer'
import CashflowChart from '../components/dashboard/CashflowChart'
import EquityCard from '../components/dashboard/EquityCard'
import type { FlowItemKey } from '../components/dashboard/WaterfallCard'
import type { IssueItem } from '../hooks/useDashboard'
import type { IssueStatus } from '../types'

export default function DashboardPage() {
  const { user } = useAuth()
  const { company } = usePageCompany()
  const db = useDashboard(company)
  // 현금흐름 추이 차트 전용 — 상환/만기처리된 항목도 포함한 전체 이력 (KPI는 db.loans/db.allInvestData의
  // activeOnly=true 값을 그대로 사용, 이 훅은 과거 시점 재구성(point-in-time)에만 사용)
  const chartLoans  = useLoans(false, company)
  const chartInvest = useInvestments(false, company)

  // ── 정책 이행 통제 (세션20차 Phase 1) — 미이행 의결사항을 대시보드 이슈로 승격 ──
  const policyData      = usePolicyDashboard(company ?? null)
  const policyParams    = usePolicyParams(company)
  const companyDecisions = usePolicyDecisionsByCompany(company ?? null)

  // ── 리짐 권고 미이행 (세션26차 Phase 4) ────────────────────────────
  // ⚠ 여기서 엔진을 돌리지 않는다. 실무 화면(/fx-regime)이 판정할 때 남긴 스냅샷만 읽는다
  //   — 대시보드는 전 사용자가 여는 화면이라 환율 이력 전체 조회를 감당할 수 없다.
  const regimeSnapshots = useMemo(
    () => readAllRegimeSnapshots(policyParams, REGIME_CURRENCIES),
    [policyParams],
  )
  const regimeIssues = useMemo<IssueItem[]>(() => {
    const today = todayStr()
    const result: IssueItem[] = []
    for (const snap of regimeSnapshots) {
      if (snap.suggestKRW <= 0) continue
      const key = makeIssueKey('fx_regime', `${company ?? ''}_${snap.currency}`)
      const thread = db.issues.threadOf(key)
      const lastStatus = thread[thread.length - 1]?.status ?? 'open'
      if (lastStatus === 'done') continue
      const days = pendingDays(snap, today, bizDaysBetween)
      // 당일 발생한 권고까지 경보로 올리면 노이즈가 된다 — 하루는 집행 시간을 준다.
      if (days == null || days < 1) continue
      const gap = snap.targetPct != null && snap.currentPct != null
        ? (snap.currentPct - snap.targetPct).toFixed(1) : '—'
      result.push({
        key,
        title: `리짐 권고 미이행 ${days}영업일차: ${snap.currency}`,
        desc: `목표 ${snap.targetPct ?? '—'}% 대비 현재 ${snap.currentPct ?? '—'}% (초과 ${gap}%p) · `
          + `권고 매도 ${fmtKRW(snap.suggestKRW)} · ${snap.since} 발생 · 판정일 ${snap.asOf}`,
        status: lastStatus,
        commentCount: thread.length,
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regimeSnapshots, company, db.issues])

  const policyIssues = useMemo<IssueItem[]>(() => {
    const today = new Date().toISOString().slice(0, 10)
    const result: IssueItem[] = []
    for (const dec of companyDecisions.data) {
      const key = makeIssueKey('policy', dec.id)
      const thread = db.issues.threadOf(key)
      const lastStatus = thread[thread.length - 1]?.status ?? 'open'
      if (lastStatus === 'done') continue

      const overdue = !!dec.due_date && dec.due_date < today
      let violated = false, violDesc = ''
      if (dec.linked_metric && dec.target_operator && dec.target_value != null) {
        const r = checkDecisionRule(dec.linked_metric, dec.target_operator, dec.target_value,
          policyData, policyParams, regimeSnapshots)
        violated = r.violated
        if (violated) {
          const cond = dec.target_operator === 'lte' ? `${dec.target_value} 이하` : `${dec.target_value} 이상`
          violDesc = `${r.label} 현재 ${r.current.toFixed(1)} (목표: ${cond})`
        }
      }
      if (!overdue && !violated) continue

      const descParts: string[] = []
      if (violated) descParts.push(`정책 위반 — ${violDesc}`)
      if (overdue)  descParts.push(`기한(${dec.due_date}) 초과`)
      result.push({
        key,
        title: `의결 미이행: ${dec.title}`,
        desc: descParts.join(' · '),
        status: lastStatus,
        commentCount: thread.length,
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDecisions.data, policyData, policyParams, db.issues])

  // ── 정책 이행 통제 (세션20차 Phase 3) — 기한(등록일+3영업일) 임박/초과 매각 지시 ──
  const sellOrders = useFxTradeHistory(company)
  const sellOrderIssues = useMemo<IssueItem[]>(() => {
    const today = todayStr()
    const result: IssueItem[] = []
    for (const o of sellOrders.data) {
      if (o.direction !== 'sell' || !o.due_date) continue
      if (o.status !== '발의' && o.status !== '승인') continue
      const key = makeIssueKey('fx_sell', o.id)
      const thread = db.issues.threadOf(key)
      const lastStatus = thread[thread.length - 1]?.status ?? 'open'
      if (lastStatus === 'done') continue
      const dday = bizDaysBetween(today, o.due_date)
      if (dday > 0) continue   // 아직 기한 여유 있음
      const typeLabel = orderTypeLabel(o.order_type)
      result.push({
        key,
        title: `외화 매각 지시 ${dday < 0 ? '기한초과' : '오늘 마감'}: ${o.currency} ${typeLabel}`,
        desc: `${typeLabel} 지시 — 기한 ${o.due_date}${dday < 0 ? ` (D+${Math.abs(dday)} 초과, 환율 무관 즉시 실행 필요)` : ' (오늘까지)'}`,
        status: lastStatus,
        commentCount: thread.length,
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellOrders.data, db.issues])

  // ── 정책 밴드 상한 초과 (세션26차 11일차) ─────────────────────────
  // 리짐 권고(regimeIssues)와 별개 경로다. 리짐은 "지금 국면상 얼마를 파는 게 좋은가",
  // 이건 "의결된 밴드를 넘겨 들고 있다"는 한도 위반 — 밴드 안에서도 리짐 목표는
  // 초과할 수 있고, 그 반대도 성립한다(세션26차 Phase 4에서 분리한 그 구분).
  // 실무 담당자가 자금정책 메뉴 권한 없이도 초과를 인지할 수 있게 여기에 올린다.
  const bandExceedIssues = useMemo<IssueItem[]>(() => {
    const r = checkFx(policyData, policyParams)
    if (r.status !== 'over' || r.max == null || r.ratio <= r.max) return []
    const key = makeIssueKey('fx_band', company ?? '')
    const thread = db.issues.threadOf(key)
    const lastStatus = thread[thread.length - 1]?.status ?? 'open'
    if (lastStatus === 'done') return []
    const excess = r.fxKrw - r.totalFund * (r.max / 100)
    return [{
      key,
      title: `외화 보유 정책 상한 초과: ${r.ratio.toFixed(1)}% (상한 ${r.max}%)`,
      desc: `보유 ${fmtKRW(r.fxKrw)} · 상한 ${fmtKRW(r.totalFund * (r.max / 100))} · 초과 ${fmtKRW(excess)} — 외화거래명세에서 매도 발의`,
      status: lastStatus,
      commentCount: thread.length,
    }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyData, policyParams, company, db.issues])

  const allIssues = useMemo(
    () => [...db.detectedIssues, ...policyIssues, ...regimeIssues, ...bandExceedIssues, ...sellOrderIssues],
    [db.detectedIssues, policyIssues, regimeIssues, bandExceedIssues, sellOrderIssues])

  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [fixedKey, setFixedKey] = useState<string | null>(null)
  const activeKey = fixedKey ?? hoverKey
  const [flowDetail, setFlowDetail] = useState<FlowItemKey | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)

  const handleHover = useCallback((key: string | null) => setHoverKey(key), [])
  const handleFocus = useCallback((key: string | null) => setFixedKey(key), [])
  const handleFlowClick = useCallback((key: FlowItemKey) => {
    setFlowDetail(prev => prev === key ? null : key)
  }, [])

  async function handleStatusChange(_key: string, _id: string, status: IssueStatus) {
    const issue = allIssues.find(i => i.key === _key)
    if (!issue || !company || !user) return
    await db.issues.addComment({
      issue_key:   _key,
      company:     company,
      user_label:  user.label,
      user_role:   user.role,
      body:        `상태를 [${status}]로 변경했습니다.`,
      status,
      issue_title: issue.title,
      issue_desc:  issue.desc,
    })
  }

  if (db.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm animate-pulse">데이터 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4" onClick={() => { if (!hoverKey) setFixedKey(null) }}>

      {/* 헤더 */}
      <div className="flex items-center gap-3 h-8">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight shrink-0">
          TREASURY Dashboard
        </h2>

        {/* 이슈 전광판: 우→좌 스크롤 ticker — 클릭 시 IssueDrawer 열기 */}
        {allIssues.filter(i => i.status !== 'done').length > 0 ? (
          <div
            className="flex-1 min-w-0 overflow-hidden relative cursor-pointer"
            onClick={e => { e.stopPropagation(); setIssueOpen(prev => !prev) }}
            title="이슈 목록 보기"
          >
            <div className="absolute inset-y-0 left-0 w-8 z-10 pointer-events-none bg-gradient-to-r from-gray-50 dark:from-gray-900 to-transparent" />
            <div className="absolute inset-y-0 right-0 w-8 z-10 pointer-events-none bg-gradient-to-l from-gray-50 dark:from-gray-900 to-transparent" />
            <div className="issue-ticker-track">
              {allIssues
                .filter(i => i.status !== 'done')
                .map(issue => (
                  <span key={issue.key} className="inline-flex items-center gap-1.5 mr-12 text-xs">
                    <span className="text-amber-500">⚠</span>
                    <span className="text-gray-600 dark:text-slate-100">{issue.title}</span>
                  </span>
                ))}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {db.latestDaily && (
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {db.latestDaily.date} 기준
            </span>
          )}
          <button
            onClick={db.refetchAll}
            className="text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2.5 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* KPI 행 — 전체 너비: 불가용 자산 카드 우측이 페이지 끝에 닿음 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="가용자금 합계"
          value={db.kpi.availableCash}
          color="blue"
          sub={`운전 ${fmtKRW(db.kpi.operatingCash)} + 가용운용 ${fmtKRW(db.kpi.investCash + db.kpi.bondCash)}${db.kpi.equityAvail > 0 ? ` + 가용지분 ${fmtKRW(db.kpi.equityAvail)}` : ''}`}
          linkedChart="상세 보기"
          onClick={() => setFlowDetail(prev => prev === 'available' ? null : 'available')}
        />
        <KpiCard
          label="순현금 포지션"
          value={db.kpi.netCashPosition}
          color={db.kpi.netCashPosition >= 0 ? 'green' : 'red'}
          sub={`가용 ${fmtKRW(db.kpi.availableCash)} − 차입 ${fmtKRW(db.kpi.totalLoan)}`}
          linkedChart="상세 보기"
          onClick={() => setFlowDetail(prev => prev === 'net' ? null : 'net')}
        />
        <KpiCard
          label="불가용 자산"
          value={db.kpi.unavailableAssets}
          color="gray"
          sub="매각·비상장"
          linkedChart="상세 보기"
          onClick={() => setFlowDetail(prev => prev === 'unavailable' ? null : 'unavailable')}
        />
      </div>

      {/* ── 메인 레이아웃: 단일 컬럼 ── */}
      <div className="flex flex-col gap-4">

        {/* 자금 흐름 + 자산 구성 — 나란히 배치 */}
        <div className="grid grid-cols-1 sm:grid-cols-[3fr_1fr] gap-4">
          <WaterfallCard
            kpi={db.kpi}
            fxKrw={(db.latestDaily?.fx_krw ?? 0) + db.kpi.investFxKrw}
            prevOperatingCash={db.prevOperatingCash ?? null}
            onItemClick={handleFlowClick}
            activeItem={flowDetail}
          />
          <AssetCompositionCard
            kpi={db.kpi}
            fxKrw={(db.latestDaily?.fx_krw ?? 0) + db.kpi.investFxKrw}
            onItemClick={key => setFlowDetail(prev => prev === key ? null : key)}
          />
        </div>

        {/* 현금흐름 추이 + 지분/장기투자 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CashflowChart
            dailyRecords={db.allDailyData}
            investments={chartInvest.data}
            loans={chartLoans.data}
          />
          <EquityCard
            equities={db.equityReturns}
            historyOf={db.equityHistoryOf}
            bonds={db.latestBonds}
            bondHistoryOf={db.bondHistoryOf}
          />
        </div>
      </div>

      {/* 자금 흐름 항목 클릭 시 팝업 드로어 */}
      <FlowDetailDrawer
        itemKey={flowDetail}
        kpi={db.kpi}
        fxKrw={(db.latestDaily?.fx_krw ?? 0) + db.kpi.investFxKrw}
        latestDaily={db.latestDaily}
        latestInvests={db.latestInvests}
        loans={db.loans}
        equities={db.equityReturns}
        company={company ?? ''}
        onClose={() => setFlowDetail(null)}
      />

      {/* 이슈 ticker 클릭 시 이슈 목록 팝업 */}
      <IssueDrawer
        open={issueOpen}
        issues={allIssues}
        activeKey={activeKey}
        onStatusChange={handleStatusChange}
        onHover={handleHover}
        onFocus={handleFocus}
        onClose={() => setIssueOpen(false)}
      />
    </div>
  )
}

