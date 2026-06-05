import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useEquities, getLatestEquities } from '../hooks/useEquities'
import { useInvestments, getLatestBonds } from '../hooks/useInvestments'
import { fetchStockPrice, fetchBondPrice } from '../hooks/useGas'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue, normDate } from '../lib/format'
import EquityHistoryPanel from '../components/equity/EquityHistoryPanel'
import BondHistoryPanel from '../components/equity/BondHistoryPanel'
import NewEquityForm from '../components/equity/NewEquityForm'
import NewBondForm from '../components/equity/NewBondForm'
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
  const [bulkState, setBulkState] = useState<{
    running: boolean; done: number; total: number; errors: string[]
  }>({ running: false, done: 0, total: 0, errors: [] })

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

  async function bulkRefreshStocks() {
    const targets = stocks.filter(s => s.ticker && s.market !== '비상장')
    if (!targets.length || !currentCompany) return
    setBulkState({ running: true, done: 0, total: targets.length, errors: [] })
    const errors: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i]
      try {
        const res = await fetchStockPrice(s.ticker)
        await eq.save({
          company:          currentCompany,
          name:             s.name,
          ticker:           s.ticker,
          market:           s.market,
          purpose:          s.purpose || '',
          available:        s.available,
          shares:           s.shares,
          price:            res.price,
          total_value:      s.shares * res.price,
          date:             normDate(res.date),
          acquisition_cost: s.acquisition_cost || 0,
        })
      } catch (e) {
        errors.push(`${s.name}: ${e instanceof Error ? e.message : '조회 실패'}`)
      }
      setBulkState(prev => ({ ...prev, done: i + 1, errors }))
    }
    setBulkState(prev => ({ ...prev, running: false }))
  }

  async function bulkRefreshBonds() {
    const targets = bonds.filter(b => b.bondTicker)
    if (!targets.length || !currentCompany) return
    setBulkState({ running: true, done: 0, total: targets.length, errors: [] })
    const errors: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const b = targets[i]
      try {
        const res = await fetchBondPrice(b.bondTicker!)
        await inv.save({
          company:          currentCompany,
          bank:             b.bondName ?? b.bank,
          product:          '국채',
          currency:         'KRW',
          amount:           calcBondValue(b.bondQty ?? 0, res.price),
          available:        b.available,
          rate:             0,
          start:            normDate(res.date),
          maturity:         '',
          active:           true,
          bondName:         b.bondName ?? b.bank,
          bondTicker:       b.bondTicker,
          bondQty:          b.bondQty,
          bondPrice:        res.price,
          priceDate:        normDate(res.date),
          acquisition_cost: b.acquisition_cost || 0,
        })
      } catch (e) {
        errors.push(`${b.bondName ?? b.bank}: ${e instanceof Error ? e.message : '조회 실패'}`)
      }
      setBulkState(prev => ({ ...prev, done: i + 1, errors }))
    }
    setBulkState(prev => ({ ...prev, running: false }))
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">지분/장기투자</h2>
        {isEditable && (
          <button
            onClick={() => tab === 'bond' ? void bulkRefreshBonds() : void bulkRefreshStocks()}
            disabled={bulkState.running || (tab === 'unlisted')}
            className="text-sm border border-blue-200 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-40 transition-colors dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            {bulkState.running
              ? `갱신 중... (${bulkState.done}/${bulkState.total})`
              : tab === 'bond' ? '🔄 전체 기준가 갱신' : '🔄 전체 시세 갱신'}
          </button>
        )}
      </div>
      {/* 일괄 갱신 결과 */}
      {!bulkState.running && bulkState.total > 0 && (
        <div className={`rounded-xl px-4 py-3 text-sm ${bulkState.errors.length > 0
          ? 'bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
          : 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'}`}>
          {bulkState.errors.length === 0
            ? `✓ ${bulkState.total}종목 시세 갱신 완료`
            : <>
                <p>⚠ {bulkState.done - bulkState.errors.length}/{bulkState.total}종목 갱신 완료</p>
                {bulkState.errors.map((e, i) => <p key={i} className="text-xs mt-0.5">{e}</p>)}
              </>
          }
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-pink-50 border border-pink-200 rounded-xl p-4 dark:bg-pink-950/30 dark:border-pink-800">
          <p className="text-xs text-pink-600 font-medium mb-1 dark:text-pink-400">지분(상장)</p>
          <p className="text-xl font-bold text-pink-800 dark:text-pink-300">{fmtKRW(stockTotal)}</p>
          <p className="text-xs text-pink-400 mt-1 dark:text-pink-500">{stocks.length}종목</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 dark:bg-blue-950/30 dark:border-blue-800">
          <p className="text-xs text-blue-600 font-medium mb-1 dark:text-blue-400">국채/채권</p>
          <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{fmtKRW(bondTotal)}</p>
          <p className="text-xs text-blue-400 mt-1 dark:text-blue-500">{bonds.length}종목</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 dark:bg-purple-950/30 dark:border-purple-800">
          <p className="text-xs text-purple-600 font-medium mb-1 dark:text-purple-400">비상장/기타</p>
          <p className="text-xl font-bold text-purple-800 dark:text-purple-300">{fmtKRW(unlistedTotal)}</p>
          <p className="text-xs text-purple-400 mt-1 dark:text-purple-500">{unlisted.length}종목</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white rounded-xl shadow dark:bg-gray-800">
        <div className="flex border-b border-gray-100 dark:border-gray-700">
          {([
            { key: 'stock',    label: `지분 (${stocks.length})` },
            { key: 'bond',     label: `국채/채권 (${bonds.length})` },
            { key: 'unlisted', label: `비상장/기타 (${unlisted.length})` },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button key={t.key}
              onClick={() => { setTab(t.key); setOpenPanel(null); setBulkState({ running: false, done: 0, total: 0, errors: [] }) }}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ─── 지분(주식) 탭 ─── */}
        {tab === 'stock' && (
          <div>
            <NewEquityForm
              company={currentCompany ?? ''}
              onSave={eq.save}
              isEditable={isEditable}
            />
            {eq.loading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">로딩 중...</p>
            ) : stocks.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">데이터가 없습니다.</p>
            ) : stocks.map(s => {
              const isOpen = openPanel === s.name
              const ret    = calcReturn(s.total_value, s.acquisition_cost)
              return (
                <div key={s.name} className="border-b border-gray-50 last:border-0 dark:border-gray-700">
                  <button
                    onClick={() => togglePanel(s.name)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.name}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{s.ticker} · {s.market}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200 text-right tabular-nums">{fmtKRW(s.total_value)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 dark:text-gray-500 text-right">{s.price.toLocaleString()}원</p>
                        <p className="hidden md:block text-xs text-gray-400 dark:text-gray-500 text-right">{s.date}</p>
                      </div>
                      <span className={`text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
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
            <NewBondForm
              company={currentCompany ?? ''}
              onSave={inv.save}
              isEditable={isEditable}
            />
            {inv.loading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">로딩 중...</p>
            ) : bonds.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">데이터가 없습니다.</p>
            ) : bonds.map(b => {
              const panelKey = b.bondTicker ?? b.bondName ?? b.bank
              const isOpen   = openPanel === panelKey
              const val      = b.bondQty && b.bondPrice ? calcBondValue(b.bondQty, b.bondPrice) : b.amount
              const ret      = calcReturn(val, b.acquisition_cost)
              const bondHistory = inv.bonds.filter(r =>
                (r.bondTicker ?? r.bondName ?? r.bank) === panelKey
              ).sort((a, b2) => (b2.priceDate ?? '').localeCompare(a.priceDate ?? ''))

              return (
                <div key={panelKey} className="border-b border-gray-50 last:border-0 dark:border-gray-700">
                  <button
                    onClick={() => togglePanel(panelKey)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{b.bondName ?? b.bank}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{b.bondTicker}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200 text-right tabular-nums">{fmtKRW(val)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 dark:text-gray-500 text-right">
                          {b.bondQty?.toLocaleString()}좌
                        </p>
                        <p className="hidden md:block text-xs text-gray-400 dark:text-gray-500 text-right">{b.priceDate}</p>
                      </div>
                      <span className={`text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
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
            <NewEquityForm
              company={currentCompany ?? ''}
              fixedMarket="비상장"
              onSave={eq.save}
              isEditable={isEditable}
            />
            {eq.loading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">로딩 중...</p>
            ) : unlisted.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">데이터가 없습니다.</p>
            ) : unlisted.map(s => {
              const isOpen = openPanel === s.name
              const ret    = calcReturn(s.total_value, s.acquisition_cost)
              return (
                <div key={s.name} className="border-b border-gray-50 last:border-0 dark:border-gray-700">
                  <button
                    onClick={() => togglePanel(s.name)}
                    className="w-full text-left px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.name}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{s.purpose || '비상장'}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-200 text-right tabular-nums">{fmtKRW(s.total_value)}</p>
                        <div className="hidden md:flex items-center gap-1.5">
                          {ret !== null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                              {fmtReturn(ret)}
                            </span>
                          )}
                        </div>
                        <p className="hidden md:block text-xs text-gray-400 dark:text-gray-500 text-right">{s.date}</p>
                      </div>
                      <span className={`text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
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
