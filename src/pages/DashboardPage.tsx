import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
import { useIssueCount } from '../contexts/issueCount'
import { fmtKRW, calcDday } from '../lib/format'
import KpiCard from '../components/dashboard/KpiCard'
import WaterfallCard from '../components/dashboard/WaterfallCard'
import IssueCard from '../components/dashboard/IssueCard'
import CashflowChart from '../components/dashboard/CashflowChart'
import EquityCard from '../components/dashboard/EquityCard'
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

  const handleHover = useCallback((key: string | null) => setHoverKey(key), [])
  const handleFocus = useCallback((key: string | null) => setFixedKey(key), [])

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

  const isOperatingActive = activeKey === 'input_daily'

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">통합 상황판</h2>
        <div className="flex items-center gap-3">
          {db.latestDaily && (
            <span className="text-xs text-gray-400">{db.latestDaily.date} 기준</span>
          )}
          <button
            onClick={db.refetchAll}
            className="text-xs text-blue-600 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-50 transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* ── 메인 레이아웃: 모바일 1열 / PC lg:8fr+3fr ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[8fr_3fr] gap-4">

        {/* ════ 좌측 메인 (8fr) ════ */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* KPI 행 — shrink-0: flex-1 하단 그리드가 늘어날 때 압축되지 않도록 고정 */}
          <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard
              label="가용자금 합계"
              value={db.kpi.availableCash}
              color="blue"
              sub={`운전 ${fmtKRW(db.kpi.operatingCash)} + 가용운용 ${fmtKRW(db.kpi.investCash)}`}
            />
            <KpiCard
              label="순현금 포지션"
              value={db.kpi.netCashPosition}
              color={db.kpi.netCashPosition >= 0 ? 'green' : 'red'}
              sub={`가용 ${fmtKRW(db.kpi.availableCash)} − 차입 ${fmtKRW(db.kpi.totalLoan)}`}
            />
            <KpiCard
              label="불가용 자산"
              value={db.kpi.unavailableAssets}
              color="gray"
              sub="매각·비상장"
            />
          </div>

          {/* 자금 흐름 — shrink-0: 고정 */}
          <div className="shrink-0"><WaterfallCard kpi={db.kpi} /></div>

          {/* 하단: 현금흐름 추이 + 지분/장기투자 — 모바일 1열 / md 이상 2열
               flex-1: 좌측 열의 남은 세로 공간을 이 행이 채워 하단 라인을 맞춤 */}
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <CashflowChart
              dailyRecords={db.allDailyData}
              investments={db.allInvestData}
              loans={db.loans}
            />
            <EquityCard
              equities={db.equityReturns}
              historyOf={db.equityHistoryOf}
              activeKey={activeKey}
              onHover={handleHover}
              onFocus={handleFocus}
            />
          </div>
        </div>

        {/* ════ 우측 패널 (3fr) ════
             · lg:self-stretch  → 좌측(8fr) 높이에 맞게 자동 늘어남
             · flex flex-col    → 내부 카드들을 세로 flex로 배치
             · 데이터 있는 카드: lg:flex-1 lg:min-h-[200px] (공간 확장)
             · 데이터 없는 카드: lg:flex-none (컴팩트 Empty State)
        ════ */}
        <div className="flex flex-col gap-3 min-w-0 lg:self-stretch">

          {/* ── 이슈 확인 ── */}
          <IssueCard
            issues={db.detectedIssues}
            activeKey={activeKey}
            onStatusChange={handleStatusChange}
            onHover={handleHover}
            onFocus={handleFocus}
            className={db.detectedIssues.length > 0
              ? 'lg:flex-1 lg:min-h-[200px]'
              : 'lg:flex-none'}
          />

          {/* ── 운전자금 상세 ── */}
          {(() => {
            const hasData = !!db.latestDaily
            return (
              <div
                onMouseEnter={() => handleHover('input_daily')}
                onMouseLeave={() => handleHover(null)}
                onClick={() => handleFocus(isOperatingActive ? null : 'input_daily')}
                className={`bg-white rounded-xl shadow flex flex-col overflow-hidden cursor-pointer transition-all ${isOperatingActive ? 'ring-2 ring-red-400 shadow-md' : 'hover:shadow-sm'} ${hasData ? 'lg:flex-1 lg:min-h-[200px]' : 'lg:flex-none'}`}
              >
                {/* 헤더 — 항상 고정 */}
                <div className="shrink-0 flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    운전자금 상세
                    {isOperatingActive && (
                      <span className="normal-case text-[10px] text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded-full">⚠ 미입력</span>
                    )}
                  </h3>
                  {db.latestDaily && (
                    <span className="text-[10px] text-gray-400">{db.latestDaily.writer}</span>
                  )}
                </div>

                {!hasData ? (
                  /* Empty State */
                  <div className="flex flex-col items-center justify-center gap-1.5 py-5 px-4">
                    <span className="text-xl">💰</span>
                    <p className="text-xs text-gray-400">오늘 운전자금 데이터가 없습니다</p>
                  </div>
                ) : (
                  /* 데이터 있음 — flex-1 스크롤 영역 */
                  <div className="custom-scrollbar overflow-y-auto flex-1 min-h-0 px-4 py-2">
                    <div className="divide-y divide-gray-50">
                      {[
                        { label: '보통예금 / CMA', value: db.latestDaily!.krw_demand },
                        { label: '국책자금',        value: db.latestDaily!.krw_govt  },
                        { label: '증권 예수금',     value: db.latestDaily!.krw_mmda  },
                        { label: '외화 (원화환산)', value: db.latestDaily!.fx_krw    },
                      ].map(r => (
                        <div key={r.label} className="flex justify-between items-center py-2">
                          <span className="text-[11px] text-gray-400">{r.label}</span>
                          <span className="text-xs tabular-nums font-semibold text-gray-700">{fmtKRW(r.value)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center py-2">
                        <span className="text-xs font-semibold text-gray-600">합계</span>
                        <span className="text-sm font-bold text-blue-600 tabular-nums">{fmtKRW(db.kpi.operatingCash)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── 운용자금 상세 ── */}
          {(() => {
            const items = db.latestInvests.filter(i => i.product !== '국채')
            const hasData = items.length > 0
            return (
              <div className={`bg-white rounded-xl shadow flex flex-col overflow-hidden ${hasData ? 'lg:flex-1 lg:min-h-[200px]' : 'lg:flex-none'}`}>
                <div className="shrink-0 px-4 pt-3.5 pb-2.5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">운용자금 상세</h3>
                </div>
                {!hasData ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-5 px-4">
                    <span className="text-xl">📈</span>
                    <p className="text-xs text-gray-400">운용 중인 자금이 없습니다</p>
                  </div>
                ) : (
                  <div className="custom-scrollbar overflow-y-auto flex-1 min-h-0 px-4 py-2">
                    <div className="divide-y divide-gray-50">
                      {items.map(inv => (
                        <div key={inv.id} className="flex justify-between items-center py-2">
                          <span className="text-[11px] text-gray-400 truncate mr-2">{inv.bank}</span>
                          <span className="text-xs tabular-nums font-semibold text-gray-700 shrink-0">{fmtKRW(inv.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── 차입금 상세 ── */}
          {(() => {
            const activeLoans = db.loans.filter(l => l.active)
            const hasData = activeLoans.length > 0
            return (
              <div className={`bg-white rounded-xl shadow flex flex-col overflow-hidden ${hasData ? 'lg:flex-1 lg:min-h-[200px]' : 'lg:flex-none'}`}>
                <div className="shrink-0 px-4 pt-3.5 pb-2.5 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">차입금 상세</h3>
                </div>
                {!hasData ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-5 px-4">
                    <span className="text-xl">🏦</span>
                    <p className="text-xs text-gray-400">활성 차입금이 없습니다</p>
                  </div>
                ) : (
                  <div className="custom-scrollbar overflow-y-auto flex-1 min-h-0 px-4 py-2">
                    <div className="space-y-0">
                      {activeLoans.map(loan => {
                        const dday       = calcDday(loan.maturity)
                        const loanKey    = `loan_${loan.id}`
                        const isActive   = activeKey === loanKey
                        const linked     = db.detectedIssues.filter(i => i.key === loanKey)
                        return (
                          <div
                            key={loan.id}
                            onMouseEnter={() => handleHover(loanKey)}
                            onMouseLeave={() => handleHover(null)}
                            onClick={e => { e.stopPropagation(); handleFocus(isActive ? null : loanKey) }}
                            className={`px-2 py-2.5 rounded-lg cursor-pointer transition-all border ${
                              isActive ? 'bg-blue-50 border-blue-200' : 'border-transparent hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-semibold text-gray-700">{loan.lender}</span>
                              <div className="flex items-center gap-1.5">
                                {isActive && linked.length > 0 && (
                                  <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">⚠ 이슈</span>
                                )}
                                <span className="text-xs tabular-nums font-semibold text-gray-700">{fmtKRW(loan.amount)}</span>
                              </div>
                            </div>
                            <div className="flex justify-between items-center mt-0.5">
                              <span className="text-[10px] text-gray-400">{loan.rate}% · {loan.maturity}</span>
                              <span className={`text-[10px] font-semibold ${dday <= 30 ? 'text-red-500' : dday <= 90 ? 'text-amber-500' : 'text-gray-400'}`}>D-{dday}</span>
                            </div>
                          </div>
                        )
                      })}
                      <div className="flex justify-between items-center border-t border-gray-100 pt-2 mt-1 px-2">
                        <span className="text-xs font-semibold text-gray-600">합계</span>
                        <span className="text-sm font-bold text-red-500 tabular-nums">{fmtKRW(db.kpi.totalLoan)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}
