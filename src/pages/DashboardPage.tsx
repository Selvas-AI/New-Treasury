import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { Company } from '../types'

const VALID_COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

export default function DashboardPage() {
  const { company } = useParams<{ company?: string }>()
  const { user, currentCompany, setCurrentCompany } = useAuth()

  // URL 파라미터로 법인이 지정된 경우 자동 전환 (master/ceo만)
  useEffect(() => {
    if (!company || user?.role === 'company') return
    if (VALID_COMPANIES.includes(company as Company)) {
      setCurrentCompany(company as Company)
    }
  }, [company, user?.role, setCurrentCompany])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-xl font-semibold text-gray-700 mb-1">통합 상황판</h2>
        <p className="text-sm text-gray-500">
          현재 법인: <strong className="text-gray-800">{currentCompany}</strong>
        </p>
        <p className="text-xs text-gray-400 mt-4">
          Step 10에서 워터폴 자금흐름 · KPI 카드 · 이슈 · 차트 구현 예정
        </p>
      </div>
    </div>
  )
}
