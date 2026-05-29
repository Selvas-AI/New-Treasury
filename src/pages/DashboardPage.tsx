import { useAuth } from '../hooks/useAuth'

export default function DashboardPage() {
  const { currentCompany } = useAuth()

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-xl font-semibold text-gray-700 mb-1">통합 상황판</h2>
        <p className="text-sm text-gray-500">
          현재 법인: <strong className="text-gray-800">{currentCompany}</strong>
        </p>
        <p className="text-xs text-gray-400 mt-4">Step 10에서 워터폴 자금흐름 · KPI 카드 · 이슈 · 차트 구현 예정</p>
      </div>
    </div>
  )
}
