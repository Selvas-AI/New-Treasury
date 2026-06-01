import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useEquities, getLatestEquities } from '../hooks/useEquities'
import { useInvestments, getLatestBonds } from '../hooks/useInvestments'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue } from '../lib/format'
import EquityHistoryPanel from '../components/equity/EquityHistoryPanel'
import BondHistoryPanel from '../components/equity/BondHistoryPanel'
import type { Company } from '../types'

const VALID_COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']
type TabKey = 'stock' | 'bond' | 'unlisted'

export default function EquityPage() {
  const { company: paramCompany, name: paramName } = useParams<{ company?: string; name?: string }>()
  const { user, currentCompany, setCurrentCompany } = useAuth()
  const eq   = useEquities()
  const inv  = useInvestments()

  const [tab, setTab]           = useState<TabKey>('stock')
  const [openPanel, setOpenPanel] = useState<string | null>(null)

  useEffect(() => {
    if (!paramCompany || user?.role === 'company') return
    if (VALID_COMPANIES.includes(paramCompany as Company)) setCurrentCompany(paramCompany as Company)
  }, [paramCompany, user?.role, setCurrentCompany])

  // 딥링크로 종목명 진입 시 패널 자동 오픈
  useEffect(() => {
    if (paramName) setOpenPanel(decodeURIComponent(paramName))
  }, [paramName])

  const isEditable = user?.role !== 'ceo'

  // ─── 지분(주식) ──────────────────────────────────────────
  const stocks    = useMemo(() => getLatestEquities(eq.data.filter(e => e.market !== '비상장')), [eq.data])
  const unlisted  = useMemo(() => getLatestEquities(eq.data.filter(e => e.market === '비상장')), [eq.data])

  // ─── 국채 ────────────────────────────────────────────────
  const bonds     = useMemo(() => getLatestBonds(inv.bonds), [inv.bonds])

  // ─── KPI 계산 ────────────────────────────────────────────
  const stockTotal    = useMemo(() => stocks.reduce((s, e) => s + e.total_value, 0), [stocks])
  const unlistedTotal = useMemo(() => unlisted.reduce((s, e) => s + e.total_value, 0), [unlisted])
  const bondTotal     = useMemo(() =>
    bonds.reduce((s, b) => s + (b.bondQty && b.bondPrice ? calcBondValue(b.bondQty, b.bondPrice) : b.amount), 0),
  [bonds])

  function togglePanel(key: string) {
    setOpenPanel(prev => prev === key ? null : key)
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* 헤더 */}
      <h2 className="text-lg font-bold text-gray-800">지분/장기투자</h2>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-pink-50 border border-pink-200 rounded-xl p-4">
          <p className="text-xs text-pink-600 font-medium mb-1">지분(상장)</p>
          <p className="text-xl font-bold text-pink-800">{fmtKRW(stockTotal)}</p>
          <p className="text-xs text-pink-400 mt-1">{stocks.length}종목</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-blue-600 font-medium mb-1">국채/채권</p>
          <p className="text-xl font-bold text-blue-800">{fmtKRW(bondTotal)}</p>
          <p className="text-xs text-blue-400 mt-1">{bonds.length}종목</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <p className="text-xs text-purple-600 font-medium mb-1">비상장/기타</p>
          <p className="text-xl font-bold text-purple-800">{fmtKRW(unlistedTotal)}</p>
          <p className="text-xs text-purple-400 mt-1">{unlisted.length}종목</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white rounded-xl shadow">
        <div className="flex border-b border-gray-100">
          {([
            { key: 'stock',    label: `지분 (${stocks.length})` },
            { key: 'bond',     label: `국채/채권 (${bonds.length})` },
            { key: 'unlisted', label: `비상장/기타 (${unlisted.length})` },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); setOpenPanel(null) }}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ─── 지분(주식) 탭 ─── */}
        {tab === 'stock' && (
          <div>
            {eq.loading ? (
              <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
            ) : stocks.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">데이터가 없습니다.</p>
            ) : stocks.map(s => {
              const isOpen = openPanel === s.name
              const ret    = calcReturn(s.total_value, s.acquisition_cost)
              return (
                <div key={s.name} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => togglePanel(s.name)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                          <p className="text-xs text-gray-400">{s.ticker} · {s.market}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 text-right tabular-nums">{fmtKRW(s.total_value)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 text-right">{s.price.toLocaleString()}원</p>
                        <p className="hidden md:block text-xs text-gray-400 text-right">{s.date}</p>
                      </div>
                      <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                    </div>
                  </button>
                  {isOpen && (
                    <EquityHistoryPanel
                      name={s.name} ticker={s.ticker} market={s.market}
                      company={currentCompany ?? ''}
                      history={eq.historyOf(s.name)}
                      onSave={eq.save}
                      onRemove={eq.remove}
                      onBulkAcq={eq.updateAcquisitionCost}
                      isEditable={isEditable}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ─── 국채/채권 탭 ─── */}
        {tab === 'bond' && (
          <div>
            {inv.loading ? (
              <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
            ) : bonds.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">데이터가 없습니다.</p>
            ) : bonds.map(b => {
              const panelKey = b.bondTicker ?? b.bondName ?? b.bank
              const isOpen   = openPanel === panelKey
              const val      = b.bondQty && b.bondPrice ? calcBondValue(b.bondQty, b.bondPrice) : b.amount
              const ret      = calcReturn(val, b.acquisition_cost)
              const bondHistory = inv.bonds.filter(r =>
                (r.bondTicker ?? r.bondName ?? r.bank) === panelKey
              ).sort((a, b2) => (b2.priceDate ?? '').localeCompare(a.priceDate ?? ''))

              return (
                <div key={panelKey} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => togglePanel(panelKey)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{b.bondName ?? b.bank}</p>
                          <p className="text-xs text-gray-400">{b.bondTicker}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 text-right tabular-nums">{fmtKRW(val)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 text-right">
                          {b.bondQty?.toLocaleString()}좌
                        </p>
                        <p className="hidden md:block text-xs text-gray-400 text-right">{b.priceDate}</p>
                      </div>
                      <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                    </div>
                  </button>
                  {isOpen && (
                    <BondHistoryPanel
                      bondName={b.bondName ?? b.bank}
                      isin={b.bondTicker ?? ''}
                      company={currentCompany ?? ''}
                      history={bondHistory}
                      onSave={inv.save}
                      onRemove={inv.remove}
                      onBulkAcq={inv.updateAcquisitionCost}
                      isEditable={isEditable}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ─── 비상장/기타 탭 ─── */}
        {tab === 'unlisted' && (
          <div>
            {eq.loading ? (
              <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
            ) : unlisted.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">데이터가 없습니다.</p>
            ) : unlisted.map(s => {
              const isOpen = openPanel === s.name
              const ret    = calcReturn(s.total_value, s.acquisition_cost)
              return (
                <div key={s.name} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => togglePanel(s.name)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                          <p className="text-xs text-gray-400">{s.purpose || '비상장'}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 text-right tabular-nums">{fmtKRW(s.total_value)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 text-right">{s.date}</p>
                      </div>
                      <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                    </div>
                  </button>
                  {isOpen && (
                    <EquityHistoryPanel
                      name={s.name} ticker={s.ticker} market={s.market}
                      company={currentCompany ?? ''}
                      history={eq.historyOf(s.name)}
                      onSave={eq.save}
                      onRemove={eq.remove}
                      onBulkAcq={eq.updateAcquisitionCost}
                      isEditable={isEditable}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
