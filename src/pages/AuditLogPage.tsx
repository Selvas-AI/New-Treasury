import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompanies } from '../hooks/useCompanies'
import { usePageCompany } from '../hooks/usePageCompany'

interface AuditLog {
  id: string
  created_at: string
  company: string
  table_name: string
  action: string
  record_id: string | null
  user_label: string
  user_role: string
  summary: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
}

const TABLE_LABELS: Record<string, string> = {
  daily: '운전자금',
  investments: '운용자금',
  loans: '차입금',
  equities: '지분/투자',
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  CREATE:    { label: '신규 등록', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  UPDATE:    { label: '수정',     color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  DELETE:    { label: '삭제',     color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  SETACTIVE: { label: '상태변경', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
}

const RANGE_OPTIONS = [
  { label: '최근 7일',  days: 7  },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
]

function fmtDatetime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AuditLogPage() {
  const { hasCompany } = useAuth()
  const { names: allCompanies } = useCompanies()
  const { company: resolvedCompany, setCompany: handleCompany } = usePageCompany('/audit-log')

  const companies = allCompanies.filter(hasCompany)

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [filterTable, setFilterTable] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetch = useCallback(async (company: string, days: number, table: string) => {
    setLoading(true)
    setError(null)
    try {
      const since = new Date()
      since.setDate(since.getDate() - days)
      let q = supabase
        .from('audit_logs')
        .select('*')
        .eq('company', company)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(500)
      if (table !== 'all') q = q.eq('table_name', table)
      const { data, error: err } = await q
      if (err) {
        if (err.message.includes('does not exist')) {
          setError('audit_logs 테이블이 없습니다. docs/db/audit_logs.sql을 Supabase에서 실행하세요.')
        } else {
          setError(err.message)
        }
      } else {
        setLogs((data ?? []) as AuditLog[])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetch(resolvedCompany, rangeDays, filterTable)
  }, [fetch, resolvedCompany, rangeDays, filterTable])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <span className="text-xl">📋</span>
        <h1 className="text-xl font-bold text-gray-800 dark:text-slate-100">변경 이력 로그</h1>
      </div>

      {/* 법인 탭 */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {companies.map(c => (
          <button
            key={c}
            onClick={() => handleCompany(c)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              resolvedCompany === c
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* 기간 */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-600">
          {RANGE_OPTIONS.map(o => (
            <button
              key={o.days}
              onClick={() => setRangeDays(o.days)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                rangeDays === o.days
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 테이블 필터 */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-600">
          <button
            onClick={() => setFilterTable('all')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${filterTable === 'all' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
          >
            전체
          </button>
          {Object.entries(TABLE_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterTable(key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${filterTable === key ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <span className="text-xs text-gray-400 dark:text-slate-500">불러오는 중...</span>}
        {!loading && !error && <span className="text-xs text-gray-400 dark:text-slate-500">{logs.length}건</span>}
      </div>

      {/* 오류 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 로그 목록 */}
      {!error && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow divide-y divide-gray-100 dark:divide-slate-700">
          {logs.length === 0 && !loading && (
            <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
              해당 기간에 변경 이력이 없습니다.
            </div>
          )}
          {logs.map(log => {
            const action = ACTION_LABELS[log.action] ?? { label: log.action, color: 'bg-gray-100 text-gray-700' }
            const tableLabel = TABLE_LABELS[log.table_name] ?? log.table_name
            const isExpanded = expandedId === log.id
            const hasDetail = !!(log.before_data || log.after_data)

            return (
              <div key={log.id} className="p-3">
                <div className="flex items-start gap-3">
                  {/* 시간 */}
                  <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap pt-0.5 w-32 shrink-0 tabular-nums">
                    {fmtDatetime(log.created_at)}
                  </span>

                  {/* 배지들 */}
                  <div className="flex flex-wrap gap-1.5 items-center shrink-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                      {tableLabel}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${action.color}`}>
                      {action.label}
                    </span>
                  </div>

                  {/* 내용 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 dark:text-slate-100 leading-snug">{log.summary}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                      {log.user_label} ({log.user_role})
                    </p>
                  </div>

                  {/* 상세 토글 */}
                  {hasDetail && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="text-xs text-blue-500 dark:text-blue-400 hover:underline shrink-0"
                    >
                      {isExpanded ? '접기' : '상세'}
                    </button>
                  )}
                </div>

                {/* 변경 전/후 상세 */}
                {isExpanded && hasDetail && (
                  <div className="mt-2 ml-44 grid grid-cols-2 gap-2 text-[11px]">
                    {log.before_data && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded p-2">
                        <p className="font-semibold text-red-600 dark:text-red-400 mb-1">변경 전</p>
                        <pre className="text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
                          {JSON.stringify(log.before_data, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.after_data && (
                      <div className="bg-green-50 dark:bg-green-900/20 rounded p-2">
                        <p className="font-semibold text-green-600 dark:text-green-400 mb-1">변경 후</p>
                        <pre className="text-green-700 dark:text-green-300 whitespace-pre-wrap break-all">
                          {JSON.stringify(log.after_data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
