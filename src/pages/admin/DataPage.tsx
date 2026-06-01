import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

interface TableStat {
  table: string
  label: string
  companies: { company: string; count: number }[]
  total: number
}

const TABLE_DEFS = [
  { table: 'daily',          label: '운전자금 (daily)' },
  { table: 'investments',    label: '운용자금 (investments)' },
  { table: 'loans',          label: '차입금 (loans)' },
  { table: 'equities',       label: '지분투자 (equities)' },
  { table: 'issue_comments', label: '이슈 코멘트' },
]

const COMPANIES = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

export default function DataPage() {
  const { user } = useAuth()
  if (user?.role !== 'master') return <Navigate to="/dashboard" replace />

  const [stats,   setStats]   = useState<TableStat[]>([])
  const [loading, setLoading] = useState(true)
  const [cleanTarget, setCleanTarget] = useState<{ table: string; company: string; before: string } | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState<string | null>(null)

  useEffect(() => { void loadStats() }, [])

  async function loadStats() {
    setLoading(true)
    const results: TableStat[] = []

    for (const def of TABLE_DEFS) {
      const companies: { company: string; count: number }[] = []
      for (const co of COMPANIES) {
        const { count } = await supabase
          .from(def.table)
          .select('*', { count: 'exact', head: true })
          .eq('company', co)
        companies.push({ company: co, count: count ?? 0 })
      }
      results.push({
        ...def,
        companies,
        total: companies.reduce((s, c) => s + c.count, 0),
      })
    }
    setStats(results)
    setLoading(false)
  }

  async function handleClean() {
    if (!cleanTarget) return
    const { table, company, before } = cleanTarget
    if (!confirm(`${company}의 ${before} 이전 ${table} 데이터를 삭제합니다. 복구 불가합니다.`)) return

    setCleaning(true)
    setCleanResult(null)

    const dateCol = table === 'daily' ? 'date' : table === 'issue_comments' ? 'created_at' : 'start'
    const { count, error } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('company', company)
      .lt(dateCol, before)

    setCleaning(false)
    if (error) { setCleanResult(`오류: ${error.message}`); return }
    setCleanResult(`✓ ${count ?? 0}건 삭제 완료`)
    setCleanTarget(null)
    void loadStats()
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">데이터 관리</h2>
        <button onClick={() => void loadStats()} disabled={loading}
          className="text-sm text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
          🔄 새로고침
        </button>
      </div>

      {/* 테이블별 데이터 현황 */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-4">테이블별 레코드 현황</h3>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">집계 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-400 font-medium pb-2 pr-6">테이블</th>
                  {COMPANIES.map(c => (
                    <th key={c} className="text-right text-xs text-gray-400 font-medium pb-2 pr-4">{c}</th>
                  ))}
                  <th className="text-right text-xs text-gray-400 font-medium pb-2">합계</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(s => (
                  <tr key={s.table} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 pr-6 text-gray-700">{s.label}</td>
                    {s.companies.map(c => (
                      <td key={c.company} className="py-2.5 pr-4 text-right tabular-nums text-gray-600">
                        {c.count.toLocaleString()}
                      </td>
                    ))}
                    <td className="py-2.5 text-right tabular-nums font-semibold text-gray-800">
                      {s.total.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 데이터 정리 */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-1">데이터 정리</h3>
        <p className="text-xs text-gray-400 mb-4">특정 날짜 이전의 데이터를 일괄 삭제합니다. 복구 불가능하므로 신중히 사용하세요.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">테이블</label>
            <select
              value={cleanTarget?.table ?? ''}
              onChange={e => setCleanTarget(t => ({ ...(t ?? { company: COMPANIES[0], before: '' }), table: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">선택</option>
              {TABLE_DEFS.filter(d => ['daily', 'equities'].includes(d.table)).map(d => (
                <option key={d.table} value={d.table}>{d.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">법인</label>
            <select
              value={cleanTarget?.company ?? ''}
              onChange={e => setCleanTarget(t => ({ ...(t ?? { table: '', before: '' }), company: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {COMPANIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">이 날짜 이전 삭제</label>
            <input type="date"
              value={cleanTarget?.before ?? ''}
              onChange={e => setCleanTarget(t => ({ ...(t ?? { table: '', company: COMPANIES[0] }), before: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>

        <button
          onClick={handleClean}
          disabled={!cleanTarget?.table || !cleanTarget?.before || cleaning}
          className="text-sm bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">
          {cleaning ? '삭제 중...' : '🗑️ 선택 데이터 삭제'}
        </button>

        {cleanResult && (
          <p className={`text-sm mt-3 ${cleanResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
            {cleanResult}
          </p>
        )}
      </div>

      {/* Supabase 대시보드 링크 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-600 mb-3">외부 관리 도구</h3>
        <div className="flex flex-wrap gap-3">
          <a href="https://supabase.com/dashboard/project/qobfmihxcclbzfaohnor"
            target="_blank" rel="noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-2 rounded-lg bg-white hover:bg-blue-50 transition-colors">
            🔗 Supabase 대시보드
          </a>
          <a href="https://github.com/Selvas-AI/New-Treasury"
            target="_blank" rel="noreferrer"
            className="text-sm text-gray-600 hover:text-gray-800 border border-gray-200 px-3 py-2 rounded-lg bg-white hover:bg-gray-50 transition-colors">
            🔗 GitHub 레포지토리
          </a>
        </div>
      </div>
    </div>
  )
}
