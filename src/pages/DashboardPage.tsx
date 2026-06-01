import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
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
  const db = useDashboard()

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
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">통합 상황판</h2>
        <div className="flex items-center gap-3">
          {db.latestDaily && (
            <span className="text-xs text-gray-400">{db.latestDaily.date} 기준</span>
          )}
          <button onClick={db.refetchAll}
            className="text-xs text-blue-600 border border-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-50 transition-colors">
            새로고침
          </button>
        </div>
      </div>

      {/* KPI 카드 행 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

      {/* 메인 2열 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── 왼쪽 2/3: 차트 영역 ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* 자금흐름 (수평바 + 도넛) + 이슈 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <WaterfallCard kpi={db.kpi} />
            <IssueCard
              issues={db.detectedIssues}
              onStatusChange={handleStatusChange}
            />
          </div>

          {/* 현금흐름 추이 — 버그 수정: allDailyData 전달 */}
          <CashflowChart
            dailyRecords={db.allDailyData}
            investments={db.allInvestData}
            loans={db.loans}
          />

          {/* 지분/장기투자 — 버그 수정: equityHistoryOf 전달 */}
          <EquityCard
            equities={db.equityReturns}
            historyOf={db.equityHistoryOf}
          />
        </div>

        {/* ── 오른쪽 1/3: 상세 패널 ── */}
        <div className="space-y-4">

          {/* 운전자금 상세 */}
          {db.latestDaily && (
            <div className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-600">운전자금 상세</h3>
                <span className="text-xs text-gray-400">{db.latestDaily.writer} 입력</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: '보통예금 / CMA', value: db.latestDaily.krw_demand },
                  { label: '국책자금',        value: db.latestDaily.krw_govt  },
                  { label: '증권 예수금',     value: db.latestDaily.krw_mmda  },
                  { label: '외화 (원화환산)', value: db.latestDaily.fx_krw    },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-xs">
                    <span className="text-gray-500">{r.label}</span>
                    <span className="tabular-nums font-medium text-gray-700">{fmtKRW(r.value)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1.5 mt-1">
                  <span className="text-gray-700">합계</span>
                  <span className="text-blue-700 tabular-nums">{fmtKRW(db.kpi.operatingCash)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 운용자금 상세 */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="text-xs font-semibold text-gray-600 mb-3">운용자금 상세</h3>
            {db.latestInvests.filter(i => i.product !== '국채').length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">없음</p>
            ) : (
              <div className="space-y-1.5">
                {db.latestInvests.filter(i => i.product !== '국채').map(inv => (
                  <div key={inv.id} className="flex justify-between text-xs">
                    <span className="text-gray-500 truncate mr-2">{inv.bank}</span>
                    <span className="tabular-nums font-medium text-gray-700 shrink-0">{fmtKRW(inv.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 차입금 상세 */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="text-xs font-semibold text-gray-600 mb-3">차입금 상세</h3>
            {db.loans.filter(l => l.active).length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">없음</p>
            ) : (
              <div className="space-y-2">
                {db.loans.filter(l => l.active).map(loan => {
                  const dday = calcDday(loan.maturity)
                  return (
                    <div key={loan.id} className="text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-600 font-medium">{loan.lender}</span>
                        <span className="tabular-nums font-medium text-gray-800">{fmtKRW(loan.amount)}</span>
                      </div>
                      <div className="flex justify-between text-gray-400 mt-0.5">
                        <span>{loan.rate}% · {loan.maturity}</span>
                        <span className={`font-medium ${
                          dday <= 30 ? 'text-red-500' : dday <= 90 ? 'text-amber-500' : 'text-gray-400'
                        }`}>D-{dday}</span>
                      </div>
                    </div>
                  )
                })}
                <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1.5">
                  <span className="text-gray-700">합계</span>
                  <span className="text-red-600 tabular-nums">{fmtKRW(db.kpi.totalLoan)}</span>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
