import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboard } from '../hooks/useDashboard'
import { fmtKRW } from '../lib/format'
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

  // URL 파라미터로 법인 자동 전환
  useEffect(() => {
    if (!company || user?.role === 'company') return
    if (VALID_COMPANIES.includes(company as Company)) {
      setCurrentCompany(company as Company)
    }
  }, [company, user?.role, setCurrentCompany])

  // 이슈 상태 변경 핸들러 (향후 코멘트 모달로 확장)
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
        <div className="text-gray-400 text-sm">데이터 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">통합 상황판</h2>
        <div className="flex items-center gap-3">
          {db.latestDaily && (
            <span className="text-xs text-gray-400">
              운전자금 기준: {db.latestDaily.date}
            </span>
          )}
          <button
            onClick={db.refetchAll}
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-md transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* KPI 카드 행 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard
          label="가용자금 합계"
          value={db.kpi.availableCash}
          color="blue"
        />
        <KpiCard
          label="순현금 포지션"
          value={db.kpi.netCashPosition}
          color={db.kpi.netCashPosition >= 0 ? 'green' : 'red'}
          sub={db.kpi.netCashPosition < 0 ? '⚠️ 차입금 > 가용자금' : undefined}
        />
        <KpiCard
          label="차입금 합계"
          value={db.kpi.totalLoan}
          color="red"
        />
        <KpiCard
          label="불가용 자산"
          value={db.kpi.unavailableAssets}
          color="gray"
        />
      </div>

      {/* 운전자금 상세 */}
      {db.latestDaily && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="보통예금/CMA"  value={db.latestDaily.krw_demand} color="blue" />
          <KpiCard label="국책자금"       value={db.latestDaily.krw_govt}   color="blue" />
          <KpiCard label="증권 예수금"    value={db.latestDaily.krw_mmda}   color="blue" />
          <KpiCard label="외화 원화환산"  value={db.latestDaily.fx_krw}     color="blue"
            sub={`USD ${db.latestDaily.fx_usd.toLocaleString()} / EUR ${db.latestDaily.fx_eur.toLocaleString()}`}
          />
        </div>
      )}

      {/* 메인 2열 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 왼쪽: 워터폴 + 이슈 */}
        <div className="space-y-5">
          <WaterfallCard items={db.waterfall} />
          <IssueCard
            issues={db.detectedIssues}
            onStatusChange={handleStatusChange}
          />
        </div>

        {/* 오른쪽: 현금흐름 차트 + 지분 카드 */}
        <div className="lg:col-span-2 space-y-5">
          <CashflowChart
            dailyRecords={db.latestDaily ? [db.latestDaily] : []}
            investments={db.latestInvests}
            loans={db.loans}
          />
          <EquityCard
            equities={db.equityReturns}
            historyOf={name => {
              // equities 훅에서 historyOf를 직접 쓸 수 없어 데이터로 계산
              return db.equityReturns.filter(e => e.name === name)
            }}
          />
        </div>
      </div>

      {/* 운용자금 요약 */}
      {db.latestInvests.length > 0 && (
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">운용자금 현황</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium pb-2">금융기관</th>
                  <th className="text-left text-xs text-gray-500 font-medium pb-2">상품</th>
                  <th className="text-right text-xs text-gray-500 font-medium pb-2">금액</th>
                  <th className="text-center text-xs text-gray-500 font-medium pb-2">가용</th>
                  <th className="text-center text-xs text-gray-500 font-medium pb-2">만기</th>
                </tr>
              </thead>
              <tbody>
                {db.latestInvests.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 text-gray-700">{inv.bank}</td>
                    <td className="py-2 text-gray-500">{inv.product}</td>
                    <td className="py-2 text-right font-medium text-gray-800 tabular-nums">
                      {fmtKRW(inv.amount)}
                    </td>
                    <td className="py-2 text-center">
                      <span className={`text-xs px-1.5 rounded ${
                        inv.available === '가용'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {inv.available}
                      </span>
                    </td>
                    <td className="py-2 text-center text-xs text-gray-500">{inv.maturity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
