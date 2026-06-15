/**
 * DailyReportListPage — 일별 자금일보 목록
 *
 * 라우트: /daily-report-list/:company?
 * 법인별 자금일보 작성 현황을 날짜순으로 표시
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { todayStr, prevBizDay, snapToBizDay } from '../lib/bizDay'
import { useCompanies, getCompanyNames } from '../hooks/useCompanies'
import type { Company } from '../types'

type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

interface ReportRow {
  id:           string
  report_date:  string
  status:       ReportStatus
  submitted_by: string | null
  submitted_at: string | null
  approved_by:  string | null
  approved_at:  string | null
  updated_at:   string
}

const STATUS: Record<ReportStatus, { label: string; cls: string }> = {
  draft:     { label: '작성 중',  cls: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300' },
  submitted: { label: '결재 중',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  approved:  { label: '승인 완료', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  rejected:  { label: '반려',     cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' },
}

export default function DailyReportListPage() {
  const { company: paramCompany } = useParams<{ company?: string }>()
  const navigate  = useNavigate()
  const { user, currentCompany, setCurrentCompany } = useAuth()
  const { names: companyNames } = useCompanies()

  const resolvedCompany: Company = (() => {
    if (paramCompany && getCompanyNames().includes(paramCompany)) return paramCompany as Company
    return currentCompany ?? '셀바스에이아이'
  })()

  const [rows,    setRows]    = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [range,   setRange]   = useState(30)  // 최근 N 영업일

  useEffect(() => {
    setLoading(true)
    // 최근 range 영업일 범위 계산 (근사: range * 1.5 달력일)
    const from = new Date()
    from.setDate(from.getDate() - Math.ceil(range * 1.5))
    const fromStr = from.toISOString().slice(0, 10)

    supabase
      .from('daily_reports')
      .select('id,report_date,status,submitted_by,submitted_at,approved_by,approved_at,updated_at')
      .eq('company', resolvedCompany)
      .gte('report_date', fromStr)
      .order('report_date', { ascending: false })
      .then(({ data }) => {
        setRows((data ?? []) as ReportRow[])
        setLoading(false)
      })
  }, [resolvedCompany, range])

  // 최근 range 영업일 날짜 목록 생성 (달력 기준으로 비영업일 dot 없는 날 표시용)
  const bizDates: string[] = (() => {
    const result: string[] = []
    let d = snapToBizDay(todayStr())
    for (let i = 0; i < range; i++) {
      result.push(d)
      d = prevBizDay(d)
    }
    return result
  })()

  const rowMap = new Map(rows.map(r => [r.report_date, r]))

  function handleCompanyChange(c: Company) {
    setCurrentCompany(c)
    navigate(`/daily-report-list/${c}`, { replace: true })
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-900">

      {/* 헤더 */}
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-3 flex items-center gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">일별 자금일보 목록</h1>
        </div>

        {/* 법인 탭 */}
        {user?.role !== 'company' && (
          <div className="flex gap-1">
            {companyNames.map(c => (
              <button
                key={c}
                onClick={() => handleCompanyChange(c)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  resolvedCompany === c ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >{c}</button>
            ))}
          </div>
        )}

        {/* 범위 선택 */}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-slate-300">
          <span>최근</span>
          {[30, 60, 90].map(n => (
            <button
              key={n}
              onClick={() => setRange(n)}
              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                range === n ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >{n}일</button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">

          {/* 요약 통계 */}
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-6 text-xs">
            <span className="text-gray-500 dark:text-slate-300 font-medium">
              최근 {range}영업일 기준
            </span>
            <span className="text-green-600 dark:text-green-400">
              승인 {rows.filter(r => r.status === 'approved').length}건
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              결재 중 {rows.filter(r => r.status === 'submitted').length}건
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              미작성 {bizDates.filter(d => !rowMap.has(d)).length}일
            </span>
            {loading && <span className="ml-auto text-gray-400 animate-pulse">조회 중…</span>}
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-slate-300 w-28">보고 대상일</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-slate-300 w-24">상태</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-slate-300">상신</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-slate-300">승인</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-500 dark:text-slate-300 w-20">바로가기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {bizDates.map(date => {
                const row = rowMap.get(date)
                const s   = row ? (STATUS[row.status] ?? STATUS.draft) : null

                return (
                  <tr
                    key={date}
                    className={`transition-colors ${row ? 'hover:bg-blue-50 dark:hover:bg-blue-900/10 cursor-pointer' : ''}`}
                    onClick={() => row && navigate(`/daily-report/${resolvedCompany}/${
                      // report_date(보고대상일) → 작성일(selectedDate) 역산: nextBizDay
                      date
                    }`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200 tabular-nums">
                      {date}
                    </td>
                    <td className="px-4 py-3">
                      {s ? (
                        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>
                          {s.label}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 text-[10px]">미작성</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-300 tabular-nums">
                      {row?.submitted_by
                        ? <><span className="font-medium text-gray-600 dark:text-slate-100">{row.submitted_by}</span> <span className="text-gray-400">{fmt(row.submitted_at)}</span></>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-300 tabular-nums">
                      {row?.approved_by
                        ? <><span className="font-medium text-green-600 dark:text-green-400">{row.approved_by}</span> <span className="text-gray-400">{fmt(row.approved_at)}</span></>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row ? (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/daily-report/${resolvedCompany}/${date}`) }}
                          className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          열기 →
                        </button>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/daily-report/${resolvedCompany}/${date}`) }}
                          className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 text-[10px]"
                        >
                          작성
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

