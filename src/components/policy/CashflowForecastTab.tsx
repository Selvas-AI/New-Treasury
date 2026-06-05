import { useState, useMemo } from 'react'
import { useCashflowPlan, get12Weeks } from '../../hooks/useCashflowPlan'
import { fmtKRW } from '../../lib/format'
import type { Company } from '../../types'

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

export default function CashflowForecastTab({ company, openingBalance, isMaster, userLabel }: Props) {
  const plan  = useCashflowPlan(company)
  const weeks = useMemo(() => get12Weeks(), [])

  // 인라인 편집 상태
  const [editing, setEditing]   = useState<string | null>(null)  // week_start
  const [form, setForm]         = useState({ inflow: '', outflow: '', memo: '' })
  const [saving, setSaving]     = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)

  // 주별 계획 map
  const planMap = useMemo(() => {
    const m = new Map<string, typeof plan.data[0]>()
    for (const r of plan.data) m.set(r.week_start, r)
    return m
  }, [plan.data])

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
      return { week, idx, inflow, outflow, net, opening, closing: balance, memo: rec?.memo ?? '', hasData: !!rec }
    })
  }, [weeks, planMap, openingBalance])

  const totalInflow  = rows.reduce((s, r) => s + r.inflow, 0)
  const totalOutflow = rows.reduce((s, r) => s + r.outflow, 0)
  const finalBalance = rows[rows.length - 1]?.closing ?? openingBalance

  function openEdit(week: string, row: typeof rows[0]) {
    setEditing(week)
    setForm({
      inflow:  row.inflow  > 0 ? String(row.inflow  / 1e8) : '',
      outflow: row.outflow > 0 ? String(row.outflow / 1e8) : '',
      memo:    row.memo,
    })
    setSaveErr(null)
  }

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    setSaveErr(null)
    const err = await plan.upsert(
      editing,
      (parseFloat(form.inflow)  || 0) * 1e8,
      (parseFloat(form.outflow) || 0) * 1e8,
      form.memo,
      userLabel,
    )
    setSaving(false)
    if (err) { setSaveErr(err); return }
    setEditing(null)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">

      {/* 요약 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">현재 운전자금</p>
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

      {/* 포캐스트 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">주별 자금수지 계획 (12주)</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">금액 단위: 억원</p>
        </div>

        {plan.loading ? (
          <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {['주차', '기간', '기초잔고', '유입 (계획)', '유출 (계획)', '순증감', '기말잔고', '메모', ''].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium px-4 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isPast    = row.week < today
                  const isCurrent = !isPast && row.idx === 0
                  const isEdit    = editing === row.week

                  return (
                    <tr key={row.week}
                      className={`border-b border-gray-50 dark:border-gray-700/50 ${
                        isPast    ? 'opacity-50' :
                        isCurrent ? 'bg-blue-50/40 dark:bg-blue-950/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      } ${row.closing < 0 ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}>

                      <td className="px-4 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {fmtWkLabel(row.idx)}
                        {isCurrent && <span className="ml-1 text-[10px] bg-blue-500 text-white px-1 py-0.5 rounded">현재</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap tabular-nums">
                        {fmtWeek(row.week)}~
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-gray-600 dark:text-gray-300">
                        {(row.opening / 1e8).toFixed(1)}억
                      </td>

                      {isEdit ? (
                        <>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.1" placeholder="0"
                              value={form.inflow}
                              onChange={e => setForm(f => ({ ...f, inflow: e.target.value }))}
                              className="w-20 border border-blue-300 rounded px-2 py-1 text-xs text-right dark:bg-gray-700 dark:border-blue-600 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.1" placeholder="0"
                              value={form.outflow}
                              onChange={e => setForm(f => ({ ...f, outflow: e.target.value }))}
                              className="w-20 border border-red-300 rounded px-2 py-1 text-xs text-right dark:bg-gray-700 dark:border-red-600 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-red-400" />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs">—</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs">—</td>
                          <td className="px-2 py-1.5">
                            <input type="text" placeholder="메모"
                              value={form.memo}
                              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                              className="w-28 border border-gray-300 rounded px-2 py-1 text-xs dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <div className="flex gap-1">
                              <button onClick={handleSave} disabled={saving}
                                className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                                {saving ? '…' : '저장'}
                              </button>
                              <button onClick={() => setEditing(null)}
                                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1.5 py-1 rounded">
                                취소
                              </button>
                            </div>
                            {saveErr && <p className="text-[10px] text-red-500 mt-0.5">{saveErr}</p>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs text-blue-700 dark:text-blue-400">
                            {row.inflow > 0 ? `+${(row.inflow / 1e8).toFixed(1)}억` : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs text-red-600 dark:text-red-400">
                            {row.outflow > 0 ? `-${(row.outflow / 1e8).toFixed(1)}억` : <span className="text-gray-300 dark:text-gray-600">—</span>}
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
                          <td className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 max-w-[120px] truncate">
                            {row.memo || <span className="text-gray-200 dark:text-gray-700">—</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {isMaster && !isPast && (
                              <button onClick={() => openEdit(row.week, row)}
                                className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                                {row.hasData ? '수정' : '입력'}
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30">
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">12주 합계</td>
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
                  <td colSpan={2} />
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
    </div>
  )
}
