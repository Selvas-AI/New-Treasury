import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
import { useIssueCount } from '../contexts/issueCount'
import { fmtKRW } from '../lib/format'
import KpiCard from '../components/dashboard/KpiCard'
import WaterfallCard from '../components/dashboard/WaterfallCard'
import AssetCompositionCard from '../components/dashboard/AssetCompositionCard'
import FlowDetailDrawer from '../components/dashboard/FlowDetailDrawer'
import IssueDrawer from '../components/dashboard/IssueDrawer'
import CashflowChart from '../components/dashboard/CashflowChart'
import EquityCard from '../components/dashboard/EquityCard'
import type { FlowItemKey } from '../components/dashboard/WaterfallCard'
import type { Company, IssueStatus } from '../types'

const VALID_COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

export default function DashboardPage() {
  const { company } = useParams<{ company?: string }>()
  const { user, currentCompany, setCurrentCompany } = useAuth()
  const { setOpenCount } = useIssueCount()
  const db = useDashboard()

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

  useEffect(() => {
    setOpenCount(db.detectedIssues.filter(i => i.status !== 'done').length)
  }, [db.detectedIssues, setOpenCount])

  useEffect(() => {
    if (!company || user?.role === 'company') return
    if (VALID_COMPANIES.includes(company as Company)) setCurrentCompany(company as Company)
  }, [company, user?.role, setCurrentCompany])

  async function handleStatusChange(_key: string, _id: string, status: IssueStatus) {
    const issue = db.detectedIssues.find(i => i.key === _key)
    if (!issue || !currentCompany || !user) return
    await db.issues.addComment({
      issue_key:   _key,
      company:     currentCompany,
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
        {db.detectedIssues.filter(i => i.status !== 'done').length > 0 ? (
          <div
            className="flex-1 min-w-0 overflow-hidden relative cursor-pointer"
            onClick={e => { e.stopPropagation(); setIssueOpen(prev => !prev) }}
            title="이슈 목록 보기"
          >
            <div className="absolute inset-y-0 left-0 w-8 z-10 pointer-events-none bg-gradient-to-r from-gray-50 dark:from-gray-900 to-transparent" />
            <div className="absolute inset-y-0 right-0 w-8 z-10 pointer-events-none bg-gradient-to-l from-gray-50 dark:from-gray-900 to-transparent" />
            <div className="issue-ticker-track">
              {db.detectedIssues
                .filter(i => i.status !== 'done')
                .map(issue => (
                  <span key={issue.key} className="inline-flex items-center gap-1.5 mr-12 text-xs">
                    <span className="text-amber-500">⚠</span>
                    <span className="text-gray-600 dark:text-gray-300">{issue.title}</span>
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
          sub={`운전 ${fmtKRW(db.kpi.operatingCash)} + 가용운용 ${fmtKRW(db.kpi.investCash)}`}
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
            fxKrw={db.latestDaily?.fx_krw ?? 0}
            prevOperatingCash={db.prevOperatingCash ?? null}
            onItemClick={handleFlowClick}
            activeItem={flowDetail}
          />
          <AssetCompositionCard
            kpi={db.kpi}
            fxKrw={db.latestDaily?.fx_krw ?? 0}
            onItemClick={key => setFlowDetail(prev => prev === key ? null : key)}
          />
        </div>

        {/* 현금흐름 추이 + 지분/장기투자 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CashflowChart
            dailyRecords={db.allDailyData}
            investments={db.allInvestData}
            loans={db.loans}
          />
          <EquityCard
            equities={db.equityReturns}
            historyOf={db.equityHistoryOf}
            bonds={db.latestBonds}
            bondHistoryOf={db.bondHistoryOf}
            activeKey={activeKey}
            onHover={handleHover}
            onFocus={handleFocus}
          />
        </div>
      </div>

      {/* 자금 흐름 항목 클릭 시 팝업 드로어 */}
      <FlowDetailDrawer
        itemKey={flowDetail}
        kpi={db.kpi}
        latestDaily={db.latestDaily}
        latestInvests={db.latestInvests}
        loans={db.loans}
        equities={db.equityReturns}
        company={currentCompany ?? ''}
        onClose={() => setFlowDetail(null)}
      />

      {/* 이슈 ticker 클릭 시 이슈 목록 팝업 */}
      <IssueDrawer
        open={issueOpen}
        issues={db.detectedIssues}
        activeKey={activeKey}
        onStatusChange={handleStatusChange}
        onHover={handleHover}
        onFocus={handleFocus}
        onClose={() => setIssueOpen(false)}
      />
    </div>
  )
}
