import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { getCompanyNames } from '../hooks/useCompanies'
import { fmtKRW, fmtNumber } from '../lib/format'
import type { Company } from '../types'

const FX_CODES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const STATUS_LIST = ['발의', '승인', '완료', '취소']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

function pnlColor(v: number | null) {
  if (v == null) return 'text-gray-400 dark:text-slate-500'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    '발의': 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
    '승인': 'bg-blue-100   dark:bg-blue-900/40   text-blue-700   dark:text-blue-300',
    '완료': 'bg-green-100  dark:bg-green-900/40  text-green-700  dark:text-green-300',
    '취소': 'bg-gray-100   dark:bg-slate-700      text-gray-500   dark:text-slate-400',
  }
  return map[s] ?? map['취소']
}

export default function FxTradeHistoryPage() {
  const { company: paramCompany } = useParams<{ company?: string }>()
  const { user, currentCompany, setCurrentCompany, canEdit, canApprove } = useAuth()
  const hist = useFxTradeHistory()

  const companies = getCompanyNames()
  const resolvedCompany = (paramCompany && companies.includes(paramCompany)
    ? paramCompany : currentCompany) as Company

  // 필터 상태
  const [filterCompany, setFilterCompany] = useState<string>(resolvedCompany ?? '전체')
  const [filterFrom,    setFilterFrom]    = useState(monthAgoStr())
  const [filterTo,      setFilterTo]      = useState(todayStr())
  const [filterCcy,     setFilterCcy]     = useState('전체')
  const [filterStatus,  setFilterStatus]  = useState('전체')

  // 완료 처리 모달
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)
  const [completeRate,   setCompleteRate]   = useState('')
  const [completing,     setCompleting]     = useState(false)

  useEffect(() => {
    if (paramCompany && companies.includes(paramCompany))
      setCurrentCompany(paramCompany as Company)
  }, [paramCompany]) // eslint-disable-line

  const doFetch = useCallback(() => {
    hist.fetch({
      company: filterCompany !== '전체' ? filterCompany as Company : undefined,
      from:    filterFrom || undefined,
      to:      filterTo   || undefined,
      currency: filterCcy,
      status:   filterStatus,
    })
  }, [filterCompany, filterFrom, filterTo, filterCcy, filterStatus]) // eslint-disable-line

  useEffect(() => { doFetch() }, []) // 초기 조회

  // 요약 통계
  const summary = useMemo(() => {
    const rows = hist.data
    const totalKrw = rows.filter(r => r.status !== '취소').reduce((s, r) => s + (r.amount_krw ?? 0), 0)
    const totalPnl = rows.filter(r => r.status === '완료').reduce((s, r) => s + (r.completed_pnl ?? r.fx_pnl ?? 0), 0)
    const byStatus = { 발의: 0, 승인: 0, 완료: 0, 취소: 0 } as Record<string, number>
    rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1 })
    return { count: rows.length, totalKrw, totalPnl, byStatus }
  }, [hist.data])

  // CSV 다운로드
  function downloadCsv() {
    const headers = ['집행일', '법인', '구분', '통화', '외화금액', '취득환율', '매도예정환율', '예상환차손익',
                     '실제체결환율', '실제환차손익', '원화금액', '상태', '발의자', '승인자', '완료자', '메모']
    const rows = hist.data.map(r => [
      r.trade_date, r.company, r.direction === 'sell' ? '매도' : '매수', r.currency,
      r.amount_fx, r.acq_rate ?? '', r.trade_rate ?? '', r.fx_pnl ?? '',
      r.completed_rate ?? '', r.completed_pnl ?? '',
      r.amount_krw ?? '', r.status,
      r.created_by ?? '', r.approved_by ?? '', r.completed_by ?? '', r.memo ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fx_trade_history_${filterFrom}_${filterTo}.csv`
    a.click()
  }

  async function handleApprove(id: string) {
    if (!window.confirm('이 발의를 승인하시겠습니까?')) return
    await hist.approve(id, user?.label ?? '')
    doFetch()
  }

  async function handleComplete() {
    if (!completeTarget || !completeRate) return
    setCompleting(true)
    try {
      await hist.complete(completeTarget, Number(completeRate), user?.label ?? '')
      setCompleteTarget(null)
      setCompleteRate('')
      doFetch()
    } finally {
      setCompleting(false)
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm('이 발의를 취소하시겠습니까?')) return
    await hist.cancel(id)
    doFetch()
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">💱 외화매매거래 이력</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">FX 매도 발의 → 승인 → 완료 누적 이력</p>
        </div>
        <button onClick={downloadCsv}
          className="text-sm px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-300
                     hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5">
          📥 CSV 다운로드
        </button>
      </div>

      {/* 검색 필터 */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">법인</div>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {companies.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">기간 시작</div>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
          <span className="text-gray-400 pb-1.5">~</span>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">기간 종료</div>
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">통화</div>
            <select value={filterCcy} onChange={e => setFilterCcy(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {FX_CODES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">상태</div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5
                         bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
              <option>전체</option>
              {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={doFetch}
            className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
            조회
          </button>
        </div>
      </div>

      {/* 요약 칩 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '조회 건수',       value: `${summary.count}건`, color: 'text-gray-900 dark:text-slate-100' },
          { label: '총 매도금액(원화)', value: fmtKRW(summary.totalKrw), color: 'text-gray-900 dark:text-slate-100' },
          { label: '누적 환차손익(완료)', value: summary.totalPnl === 0 ? '—' : `${summary.totalPnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(summary.totalPnl))}`,
            color: summary.totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400' },
          { label: '발의/승인/완료/취소',
            value: `${summary.byStatus['발의']??0} / ${summary.byStatus['승인']??0} / ${summary.byStatus['완료']??0} / ${summary.byStatus['취소']??0}`,
            color: 'text-gray-900 dark:text-slate-100' },
        ].map(chip => (
          <div key={chip.label} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{chip.label}</p>
            <p className={`text-base font-bold tabular-nums ${chip.color}`}>{chip.value}</p>
          </div>
        ))}
      </div>

      {/* 이력 테이블 */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {hist.loading ? (
          <div className="text-center py-12 text-sm text-gray-400 dark:text-slate-500">불러오는 중…</div>
        ) : hist.data.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400 dark:text-slate-500">조회된 이력이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                  {['집행일', '법인', '구분', '통화', '외화금액', '취득환율', '매도환율', '예상 환차손익',
                    '실체결환율', '확정 환차손익', '원화금액', '상태', '발의자', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-sky-300 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {hist.data.map(r => {
                  const displayRate = r.status === '완료' ? r.completed_rate : r.trade_rate
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-gray-700 dark:text-slate-300">{r.trade_date}</td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300 whitespace-nowrap">{r.company}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          r.direction === 'sell'
                            ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        }`}>
                          {r.direction === 'sell' ? '매도' : '매수'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-slate-200">{r.currency}</td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-700 dark:text-slate-300 whitespace-nowrap">
                        {fmtNumber(r.amount_fx, r.currency === 'JPY' ? 0 : 2)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                        {r.acq_rate != null ? fmtNumber(r.acq_rate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                        {displayRate != null ? fmtNumber(displayRate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums text-right whitespace-nowrap font-medium ${pnlColor(r.fx_pnl)}`}>
                        {r.fx_pnl != null
                          ? `${r.fx_pnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(r.fx_pnl))}`
                          : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">
                        {r.completed_rate != null ? fmtNumber(r.completed_rate, 2) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums text-right whitespace-nowrap font-medium ${pnlColor(r.completed_pnl)}`}>
                        {r.completed_pnl != null
                          ? `${r.completed_pnl >= 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(r.completed_pnl))}`
                          : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-700 dark:text-slate-300 whitespace-nowrap">
                        {r.amount_krw != null ? fmtKRW(r.amount_krw) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">{r.created_by ?? ''}</td>
                      {/* 액션 */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex gap-1">
                          {r.status === '발의' && canApprove() && (
                            <button onClick={() => handleApprove(r.id)}
                              className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                              승인
                            </button>
                          )}
                          {r.status === '승인' && canEdit() && (
                            <button onClick={() => { setCompleteTarget(r.id); setCompleteRate('') }}
                              className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                              완료
                            </button>
                          )}
                          {(r.status === '발의' || r.status === '승인') && canApprove() && (
                            <button onClick={() => handleCancel(r.id)}
                              className="text-xs px-2.5 py-1 border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
                              취소
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 완료 처리 모달 */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setCompleteTarget(null) }}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 dark:border-slate-700"
            style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
              <p className="text-base font-semibold text-gray-800 dark:text-slate-100">✅ 체결 완료 처리</p>
              <p className="text-xs text-gray-400 mt-0.5">실제 체결 환율을 입력하세요.</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-300 block mb-1">실제 체결 환율</label>
                <input type="number" step="0.01" value={completeRate}
                  onChange={e => setCompleteRate(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2
                             bg-white dark:bg-slate-700 text-gray-900 dark:text-white tabular-nums"
                  placeholder="예: 1295.50" />
              </div>
              {completeRate && (() => {
                const rec = hist.data.find(r => r.id === completeTarget)
                if (!rec || !rec.acq_rate) return null
                const pnl = (Number(completeRate) - rec.acq_rate) * rec.amount_fx
                return (
                  <div className={`px-3 py-2 rounded-lg text-xs font-medium ${pnl >= 0
                    ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'}`}>
                    확정 환차{pnl >= 0 ? '익' : '손'}: {pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(pnl))}
                  </div>
                )
              })()}
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setCompleteTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 rounded-lg">
                취소
              </button>
              <button onClick={handleComplete} disabled={completing || !completeRate}
                className="px-5 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
                {completing ? '저장 중...' : '완료 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
