import { useState, useMemo, useRef } from 'react'
import { useCashflowPlan, get12Weeks, type CashflowPlanItem } from '../../hooks/useCashflowPlan'
import { IN_CATEGORIES, OUT_CATEGORIES } from '../../lib/dailyReportCategories'
import { downloadCashflowTemplate, parseCashflowExcel, type ParsedCashflowResult } from '../../lib/cashflowExcel'
import { fmtKRW } from '../../lib/format'
import WeekCashflowModal from './WeekCashflowModal'
import type { Company } from '../../types'

const PLAN_IN_CATEGORIES  = IN_CATEGORIES.filter(c => c.code !== 'invest_eval_in')
const PLAN_OUT_CATEGORIES = OUT_CATEGORIES.filter(c => c.code !== 'invest_eval_out')

interface Props {
  company:        Company
  openingBalance: number   // 현재 운전자금 (운전자금 최신값)
  isMaster:       boolean
  userLabel:      string
}

function fmtWeek(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function fmtWkLabel(idx: number): string {
  if (idx === 0) return '이번 주'
  if (idx === 1) return '다음 주'
  return `+${idx}주`
}

/** 해당 주(월요일 기준)가 완전히 지났는지 — 일요일(월요일+6일)까지 지나야 과거로 판정.
 *  week_start(월요일)와 오늘을 직접 비교하면 이번 주도 화~일요일엔 "과거"로 오판된다. */
function isWeekPast(weekStart: string, today: string): boolean {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  return end.toISOString().slice(0, 10) < today
}

export default function CashflowForecastTab({ company, openingBalance, isMaster, userLabel }: Props) {
  const plan  = useCashflowPlan(company)
  const weeks = useMemo(() => get12Weeks(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 상세 모달 상태 (특정 주 × 방향)
  const [detail, setDetail] = useState<{ week: string; direction: 'in' | 'out' } | null>(null)

  // 엑셀 임포트 상태
  const [importPreview, setImportPreview] = useState<ParsedCashflowResult | null>(null)
  const [importing,     setImporting]     = useState(false)
  const [importMsg,     setImportMsg]     = useState<string | null>(null)

  // 주별 계획 map
  const planMap = useMemo(() => {
    const m = new Map<string, typeof plan.data[0]>()
    for (const r of plan.data) m.set(r.week_start, r)
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.data])

  // 주별 항목 map (week_start → items)
  const itemsByWeek = useMemo(() => {
    const m = new Map<string, CashflowPlanItem[]>()
    for (const it of plan.items) {
      const list = m.get(it.week_start) ?? []
      list.push(it)
      m.set(it.week_start, list)
    }
    return m
  }, [plan.items])

  // 주별 잔고 누적 계산
  const rows = useMemo(() => {
    let balance = openingBalance
    return weeks.map((week, idx) => {
      const rec     = planMap.get(week)
      const inflow  = rec?.inflow  ?? 0
      const outflow = rec?.outflow ?? 0
      const net     = inflow - outflow
      const opening = balance
      balance += net
      return { week, idx, inflow, outflow, net, opening, closing: balance }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, planMap, openingBalance, plan.loading])

  const totalInflow  = rows.reduce((s, r) => s + r.inflow, 0)
  const totalOutflow = rows.reduce((s, r) => s + r.outflow, 0)
  const finalBalance = rows[rows.length - 1]?.closing ?? openingBalance

  const today = new Date().toISOString().slice(0, 10)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportMsg(null)
    try {
      const result = await parseCashflowExcel(file, company, weeks, PLAN_IN_CATEGORIES, PLAN_OUT_CATEGORIES)
      setImportPreview(result)
    } catch (err) {
      setImportMsg(err instanceof Error ? `파일 분석 실패: ${err.message}` : '파일 분석 실패')
    }
  }

  async function handleConfirmImport() {
    if (!importPreview || importPreview.rows.length === 0) return
    setImporting(true)
    const err = await plan.bulkSyncFromImport(importPreview.rows, userLabel)
    setImporting(false)
    if (err) { setImportMsg(`저장 실패: ${err}`); return }
    setImportMsg(`✅ ${importPreview.rows.length}건 반영 완료`)
    setImportPreview(null)
  }

  const detailWeekRow = detail ? rows.find(r => r.week === detail.week) : null

  return (
    <div className="space-y-4">

      {/* 요약 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <p className="text-xs text-gray-500 dark:text-slate-300 mb-1">현재 운전자금</p>
          <p className="text-base font-bold text-gray-800 dark:text-white">{fmtKRW(openingBalance)}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
          <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">12주 예상 유입</p>
          <p className="text-base font-bold text-blue-800 dark:text-blue-300">{fmtKRW(totalInflow)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800 p-4">
          <p className="text-xs text-red-600 dark:text-red-400 mb-1">12주 예상 유출</p>
          <p className="text-base font-bold text-red-800 dark:text-red-300">{fmtKRW(totalOutflow)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${finalBalance >= 0
          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
          : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'}`}>
          <p className={`text-xs mb-1 ${finalBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            12주 후 예상 잔고
          </p>
          <p className={`text-base font-bold ${finalBalance >= 0 ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}>
            {fmtKRW(finalBalance)}
          </p>
        </div>
      </div>

      {/* 엑셀 임포트 */}
      {isMaster && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => downloadCashflowTemplate(company, weeks)}
            className="text-xs border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
            📄 템플릿 다운로드
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            className="text-xs border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
            📥 엑셀 업로드
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => void handleFileChange(e)} />
          {importMsg && <span className="text-xs text-gray-500 dark:text-slate-400">{importMsg}</span>}
        </div>
      )}

      {/* 포캐스트 테이블 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">주별 자금수지 계획 (12주)</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">금액을 클릭하면 항목별 상세를 입력할 수 있습니다</p>
        </div>

        {plan.loading ? (
          <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-700">
                  {['주차', '기간', '기초잔고', '유입 (계획)', '유출 (계획)', '순증감', '기말잔고'].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium px-4 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isPast    = isWeekPast(row.week, today)
                  const isCurrent = !isPast && row.idx === 0
                  const inCount   = (itemsByWeek.get(row.week) ?? []).filter(i => i.direction === 'in').length
                  const outCount  = (itemsByWeek.get(row.week) ?? []).filter(i => i.direction === 'out').length

                  return (
                    <tr key={row.week}
                      className={`border-b border-gray-50 dark:border-slate-700/50 ${
                        isPast    ? 'opacity-50' :
                        isCurrent ? 'bg-blue-50/40 dark:bg-blue-950/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                      } ${row.closing < 0 ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}>

                      <td className="px-4 py-2.5 text-xs font-medium text-gray-600 dark:text-slate-100 whitespace-nowrap">
                        {fmtWkLabel(row.idx)}
                        {isCurrent && <span className="ml-1 text-[10px] bg-blue-500 text-white px-1 py-0.5 rounded">현재</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-300 whitespace-nowrap tabular-nums">
                        {fmtWeek(row.week)}~
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-gray-600 dark:text-slate-100">
                        {(row.opening / 1e8).toFixed(1)}억
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => setDetail({ week: row.week, direction: 'in' })}
                          className="tabular-nums text-xs text-blue-700 dark:text-blue-400 hover:underline">
                          {row.inflow > 0 ? `+${(row.inflow / 1e8).toFixed(1)}억` : <span className="text-gray-300 dark:text-gray-600">입력</span>}
                          {inCount > 0 && <span className="ml-1 text-[10px] text-gray-400">({inCount})</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => setDetail({ week: row.week, direction: 'out' })}
                          className="tabular-nums text-xs text-red-600 dark:text-red-400 hover:underline">
                          {row.outflow > 0 ? `-${(row.outflow / 1e8).toFixed(1)}억` : <span className="text-gray-300 dark:text-gray-600">입력</span>}
                          {outCount > 0 && <span className="ml-1 text-[10px] text-gray-400">({outCount})</span>}
                        </button>
                      </td>

                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-medium ${
                        row.net > 0 ? 'text-blue-600 dark:text-blue-400' :
                        row.net < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                        {row.net !== 0
                          ? `${row.net > 0 ? '+' : ''}${(row.net / 1e8).toFixed(1)}억`
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-semibold ${row.closing < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>
                        {(row.closing / 1e8).toFixed(1)}억
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/30">
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-slate-100">12주 합계</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold text-blue-700 dark:text-blue-400">
                    +{(totalInflow / 1e8).toFixed(1)}억
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold text-red-600 dark:text-red-400">
                    -{(totalOutflow / 1e8).toFixed(1)}억
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-bold ${
                    totalInflow - totalOutflow >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
                    {totalInflow - totalOutflow >= 0 ? '+' : ''}{((totalInflow - totalOutflow) / 1e8).toFixed(1)}억
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums text-xs font-bold ${finalBalance >= 0 ? 'text-gray-800 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>
                    {(finalBalance / 1e8).toFixed(1)}억
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {!isMaster && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          포캐스트 입력은 master 계정만 가능합니다.
        </p>
      )}

      {/* 주×방향 상세 모달 */}
      {detail && detailWeekRow && (
        <WeekCashflowModal
          weekLabel={`${fmtWkLabel(detailWeekRow.idx)} (${fmtWeek(detail.week)}~)`}
          direction={detail.direction}
          items={(itemsByWeek.get(detail.week) ?? []).filter(i => i.direction === detail.direction)}
          readOnly={!isMaster || isWeekPast(detail.week, today)}
          onClose={() => setDetail(null)}
          onAdd={(category, amount, memo) => plan.addItem(detail.week, detail.direction, category, amount, memo, userLabel)}
          onUpdate={(id, patch) => plan.updateItem(id, patch, userLabel)}
          onRemove={id => plan.removeItem(id, userLabel)}
        />
      )}

      {/* 엑셀 임포트 미리보기 모달 */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) setImportPreview(null) }}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm">엑셀 업로드 미리보기</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                인식된 항목 {importPreview.rows.length}건 {importPreview.errors.length > 0 && `· 제외 ${importPreview.errors.length}건`}
              </p>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
              {importPreview.rows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-1.5">반영될 항목</p>
                  <div className="space-y-1">
                    {importPreview.rows.slice(0, 20).map((r, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-600 dark:text-slate-300">
                        <span>{fmtWeek(r.week_start)}~ · {r.direction === 'in' ? '입금' : '출금'} · {r.category}</span>
                        <span className="tabular-nums">{fmtKRW(r.amount)}</span>
                      </div>
                    ))}
                    {importPreview.rows.length > 20 && (
                      <p className="text-[11px] text-gray-400">외 {importPreview.rows.length - 20}건</p>
                    )}
                  </div>
                </div>
              )}
              {importPreview.errors.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">⚠ 제외된 행</p>
                  {importPreview.errors.map((e, i) => <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">{e}</p>)}
                </div>
              )}
              {importPreview.rows.length > 0 && (
                <p className="text-[11px] text-blue-600 dark:text-blue-400">
                  ⓘ 위 항목에 포함된 주차는 기존 입력 내용을 전부 지우고 파일 내용으로 교체됩니다.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-slate-700 shrink-0">
              <button onClick={() => setImportPreview(null)}
                className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
                취소
              </button>
              <button onClick={() => void handleConfirmImport()} disabled={importing || importPreview.rows.length === 0}
                className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {importing ? '저장 중...' : `반영 (${importPreview.rows.length}건)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
