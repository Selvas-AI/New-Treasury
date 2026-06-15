import { useState } from 'react'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { fmtKRW, calcBondValue } from '../../lib/format'
import type { InvestmentRecord } from '../../types'

const SCENARIOS = [
  { label: '-100bp', bp: -100 },
  { label: '-50bp',  bp: -50  },
  { label: '-10bp',  bp: -10  },
  { label: '현재',   bp: 0    },
  { label: '+10bp',  bp: 10   },
  { label: '+50bp',  bp: 50   },
  { label: '+100bp', bp: 100  },
]

export default function FvplRiskTab({
  bonds,
  params,
  isMaster,
  userLabel,
}: {
  bonds: InvestmentRecord[]
  params: ReturnType<typeof usePolicyParams>
  isMaster: boolean
  userLabel: string
}) {
  const activeBonds = bonds.filter(b => b.active)
  const [editingDuration, setEditingDuration] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  async function saveDuration(bond: InvestmentRecord) {
    const key = bond.id
    const val = Number(editingDuration[key])
    if (!val || val <= 0) return
    setSavingId(key)
    await params.set(`fvpl_duration_${bond.id}`, val, null, userLabel)
    setSavingId(null)
    setEditingDuration(p => { const n = { ...p }; delete n[key]; return n })
  }

  if (activeBonds.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400 dark:text-gray-500">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm">운용 중인 국채가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {activeBonds.map(bond => {
        const durationKey    = `fvpl_duration_${bond.id}`
        const duration       = params.get(durationKey) ?? 0
        const currentValue   = bond.bondQty && bond.bondPrice
          ? calcBondValue(bond.bondQty, bond.bondPrice)
          : bond.amount
        const acquisitionCost = bond.acquisition_cost || bond.amount
        const unrealizedPL   = currentValue - acquisitionCost
        const unrealizedPct  = acquisitionCost > 0 ? (unrealizedPL / acquisitionCost) * 100 : 0
        const isEditing      = editingDuration[bond.id] !== undefined

        return (
          <div key={bond.id} className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">

            {/* 채권 헤더 */}
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{bond.bondName ?? bond.bank}</p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-slate-300">
                    {bond.bondTicker && <span>ISIN: {bond.bondTicker}</span>}
                    <span>만기: {bond.maturity}</span>
                    <span>금리: {bond.rate}%</span>
                  </div>
                </div>
                {/* Duration 입력 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500">Duration</span>
                  {isEditing ? (
                    <>
                      <input type="number" step="0.1" min="0"
                        value={editingDuration[bond.id]}
                        onChange={e => setEditingDuration(p => ({ ...p, [bond.id]: e.target.value }))}
                        className="w-20 text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1
                                   bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                      <button onClick={() => saveDuration(bond)} disabled={savingId === bond.id}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50">
                        {savingId === bond.id ? '…' : '저장'}
                      </button>
                      <button onClick={() => setEditingDuration(p => { const n = { ...p }; delete n[bond.id]; return n })}
                        className="text-xs text-gray-400 hover:text-gray-600">취소</button>
                    </>
                  ) : (
                    <>
                      <span className={`text-sm font-bold ${duration > 0 ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300'}`}>
                        {duration > 0 ? `${duration}년` : '미입력'}
                      </span>
                      {isMaster && (
                        <button onClick={() => setEditingDuration(p => ({ ...p, [bond.id]: String(duration || '') }))}
                          className="text-xs text-blue-500 hover:text-blue-700">✏️</button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 현재 손익 */}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">취득원가</p>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(acquisitionCost)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">현재 평가금액</p>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{fmtKRW(currentValue)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">평가손익</p>
                  <p className={`text-sm font-bold ${unrealizedPL >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                    {unrealizedPL >= 0 ? '+' : ''}{fmtKRW(unrealizedPL)}
                    <span className="ml-1 text-xs">({unrealizedPct.toFixed(1)}%)</span>
                  </p>
                </div>
              </div>
            </div>

            {/* 금리 시나리오 */}
            <div className="p-4">
              <p className="text-xs font-medium text-gray-500 dark:text-slate-300 mb-3">
                금리 변동 시나리오 분석
                {duration <= 0 && (
                  <span className="ml-2 text-amber-500">⚠️ Duration 미입력 — 계산 불가</span>
                )}
              </p>
              {duration > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-700">
                        {['시나리오', '채권가격 변동', '추가 손익', '누적 평가손익', ''].map(h => (
                          <th key={h} className="text-left text-xs text-gray-400 font-medium pb-2 pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SCENARIOS.map(sc => {
                        const pricePct     = -(duration * sc.bp) / 10000
                        const additionalPL = currentValue * pricePct
                        const cumulativePL = unrealizedPL + additionalPL
                        const isBase       = sc.bp === 0
                        const isBad        = cumulativePL < -acquisitionCost * 0.1
                        return (
                          <tr key={sc.bp}
                            className={`border-b border-gray-50 dark:border-slate-700/50 ${isBase ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}>
                            <td className={`py-2.5 pr-4 font-medium ${isBase ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>
                              {sc.label}
                            </td>
                            <td className={`py-2.5 pr-4 tabular-nums ${pricePct >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                              {isBase ? '—' : `${pricePct >= 0 ? '+' : ''}${(pricePct * 100).toFixed(2)}%`}
                            </td>
                            <td className={`py-2.5 pr-4 tabular-nums ${additionalPL >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                              {isBase ? '—' : `${additionalPL >= 0 ? '+' : ''}${fmtKRW(additionalPL)}`}
                            </td>
                            <td className={`py-2.5 pr-4 tabular-nums font-semibold ${cumulativePL >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                              {cumulativePL >= 0 ? '+' : ''}{fmtKRW(cumulativePL)}
                            </td>
                            <td className="py-2.5">
                              {isBad  && <span className="text-xs text-red-500">🔴 한도초과</span>}
                              {isBase && <span className="text-xs text-blue-500">← 현재</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  {isMaster
                    ? '위 ✏️ 버튼으로 Duration을 입력하면 시나리오가 표시됩니다.'
                    : 'Duration 값이 입력되지 않았습니다.'}
                </div>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                * ΔPrice ≈ -Duration × ΔYield (1차 근사). Duration = {duration > 0 ? `${duration}년` : '미입력'}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

