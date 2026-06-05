import { useState, useMemo } from 'react'
import { usePolicyBankLimits } from '../../hooks/usePolicyBankLimits'
import { getLatestInvestments } from '../../hooks/useInvestments'
import { fmtKRW } from '../../lib/format'
import type { Company, InvestmentRecord } from '../../types'

export const BANK_TYPES = ['은행', '증권사', '보험', '기타'] as const
const DEFAULT_LIMIT_PCT = 30

/** 기업은행(007) → 기업은행 : 괄호 suffix 제거로 동일 기관 통합 */
export function normBank(bank: string): string {
  return bank.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

interface Props {
  company:     Company
  investments: InvestmentRecord[]
  isMaster:    boolean
  userLabel:   string
}

interface BankRow {
  bank:       string
  bankType:   string
  amount:     number    // 현재 운용 잔고 (0이면 미운용)
  pct:        number
  limitPct:   number
  limitAmt:   number | null
  status:     'ok' | 'warn' | 'over' | 'na'
  limitId:    string | null
  note:       string
  registered: boolean   // policy_bank_limits에 등록된 기관 여부
}

function StatusBadge({ status }: { status: BankRow['status'] }) {
  if (status === 'ok')   return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">✓ 정상</span>
  if (status === 'warn') return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 font-medium">⚠ 주의</span>
  if (status === 'over') return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">✕ 초과</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">—</span>
}

const EMPTY_FORM = { bankType: '은행' as typeof BANK_TYPES[number], limitPct: '30', limitAmt: '', note: '' }

export default function BankLimitsTab({ company, investments, isMaster, userLabel }: Props) {
  const limits = usePolicyBankLimits(company)

  // 편집/등록 폼 상태
  const [editBank, setEditBank]   = useState<string | null>(null)
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 신규 기관 등록 폼 상태 (운용 내역 없는 기관 사전 등록용)
  const [addOpen, setAddOpen]     = useState(false)
  const [addForm, setAddForm]     = useState({ bankName: '', bankType: '은행' as typeof BANK_TYPES[number] })
  const [addErr, setAddErr]       = useState<string | null>(null)

  // ── 잔고 집계 ──────────────────────────────────────────────────────────
  const latestInvests = useMemo(() => getLatestInvestments(investments), [investments])
  const totalAmt = useMemo(() => latestInvests.reduce((s, i) => s + (i.amount || 0), 0), [latestInvests])

  // ── bankRows: 운용 기관 + 마스터 등록 기관 합산 ────────────────────────
  const bankRows = useMemo<BankRow[]>(() => {
    // 1. 운용 잔고 집계 (괄호 suffix 정규화)
    const grouped = new Map<string, number>()
    for (const i of latestInvests) {
      const key = normBank(i.bank)
      grouped.set(key, (grouped.get(key) ?? 0) + (i.amount || 0))
    }

    // 2. 마스터 등록 기관도 포함 (운용 잔고 없으면 0)
    for (const l of limits.data) {
      const key = normBank(l.bank_name)
      if (!grouped.has(key)) grouped.set(key, 0)
    }

    // 3. 행 생성 (잔고 내림차순 → 미운용 기관 하단)
    return Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([bank, amount]) => {
        const pct      = totalAmt > 0 ? (amount / totalAmt) * 100 : 0
        const limitRec = limits.data.find(l => normBank(l.bank_name) === bank)
        const limitPct = limitRec?.limit_pct ?? DEFAULT_LIMIT_PCT
        const limitAmt = limitRec?.limit_amt ?? null

        const status: BankRow['status'] =
          amount === 0         ? 'na' :
          pct > limitPct       ? 'over' :
          pct > limitPct * 0.9 ? 'warn' : 'ok'

        return {
          bank,
          bankType:   limitRec?.bank_type ?? '기타',
          amount,
          pct,
          limitPct,
          limitAmt,
          status,
          limitId:    limitRec?.id ?? null,
          note:       limitRec?.note ?? '',
          registered: !!limitRec,
        }
      })
  }, [latestInvests, limits.data, totalAmt])

  // ── 기관 등록/한도 설정 ─────────────────────────────────────────────────
  function openEdit(bank: string, row?: BankRow) {
    setEditBank(bank)
    setForm({
      bankType: (row?.bankType as typeof BANK_TYPES[number]) ?? '은행',
      limitPct: String(row?.limitPct ?? DEFAULT_LIMIT_PCT),
      limitAmt: row?.limitAmt ? String(row.limitAmt / 1e8) : '',
      note:     row?.note ?? '',
    })
    setSaveError(null)
  }

  async function handleSave() {
    if (!editBank) return
    setSaving(true)
    setSaveError(null)
    const err = await limits.upsert({
      company,
      bank_name:  normBank(editBank),
      bank_type:  form.bankType,
      limit_pct:  parseFloat(form.limitPct) || DEFAULT_LIMIT_PCT,
      limit_amt:  form.limitAmt ? parseFloat(form.limitAmt) * 1e8 : null,
      note:       form.note,
      updated_by: userLabel,
    })
    setSaving(false)
    if (err) { setSaveError(err); return }
    setEditBank(null)
  }

  // 신규 기관 사전 등록 (운용 없이 마스터에만 추가)
  async function handleAddBank() {
    const name = addForm.bankName.trim()
    if (!name) { setAddErr('기관명을 입력하세요.'); return }
    if (bankRows.some(r => r.bank === normBank(name))) {
      setAddErr('이미 존재하는 기관입니다.'); return
    }
    setAddErr(null)
    const err = await limits.upsert({
      company,
      bank_name:  normBank(name),
      bank_type:  addForm.bankType,
      limit_pct:  DEFAULT_LIMIT_PCT,
      limit_amt:  null,
      note:       '',
      updated_by: userLabel,
    })
    if (err) { setAddErr(err); return }
    setAddForm({ bankName: '', bankType: '은행' })
    setAddOpen(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('마스터 등록을 삭제하시겠습니까? (운용 잔고가 있으면 기타 기관으로 표시됩니다.)')) return
    await limits.remove(id)
  }

  const overCount = bankRows.filter(r => r.status === 'over').length
  const warnCount = bankRows.filter(r => r.status === 'warn').length
  const activeCount = bankRows.filter(r => r.amount > 0).length

  return (
    <div className="space-y-4">

      {/* KPI 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">총 운용자금</p>
          <p className="text-lg font-bold text-gray-800 dark:text-white">{fmtKRW(totalAmt)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            운용 {activeCount}개 · 등록 {bankRows.length}개 기관
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${overCount > 0
          ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
          : 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">한도 초과 기관</p>
          <p className={`text-lg font-bold ${overCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
            {overCount}개
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">주의 {warnCount}개</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">규정 기본 한도</p>
          <p className="text-lg font-bold text-gray-800 dark:text-white">30%</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">자금운용관리규정 §9</p>
        </div>
      </div>

      {/* 기관별 운용 현황 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">기관별 운용 현황</h3>
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400 dark:text-gray-500">90%↑ 주의 · 100%↑ 초과</p>
            {isMaster && (
              <button onClick={() => { setAddOpen(true); setAddErr(null) }}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">
                + 거래기관 등록
              </button>
            )}
          </div>
        </div>

        {limits.loading ? (
          <p className="text-sm text-gray-400 text-center py-8">로딩 중...</p>
        ) : bankRows.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm text-gray-400">등록된 거래 금융기관이 없습니다.</p>
            {isMaster && <p className="text-xs text-gray-400">"+ 거래기관 등록" 버튼으로 먼저 기관을 등록하세요.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {['금융기관', '구분', '잔고', '비중', '한도', '상태', ''].map(h => (
                    <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium px-4 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bankRows.map(row => (
                  <tr key={row.bank}
                    className={`border-b border-gray-50 dark:border-gray-700/50 ${
                      row.amount === 0  ? 'opacity-50' :
                      row.status === 'over' ? 'bg-red-50/40 dark:bg-red-950/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">
                      {row.bank}
                      {!row.registered && (
                        <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1 rounded">미등록</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{row.bankType}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {row.amount > 0 ? fmtKRW(row.amount) : <span className="text-gray-300 dark:text-gray-600">미운용</span>}
                    </td>
                    <td className="px-4 py-3">
                      {row.amount > 0 ? (
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${row.status === 'over' ? 'bg-red-500' : row.status === 'warn' ? 'bg-orange-400' : 'bg-blue-500'}`}
                              style={{ width: `${Math.min(row.pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 w-10 text-right">
                            {row.pct.toFixed(1)}%
                          </span>
                        </div>
                      ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {row.limitAmt ? fmtKRW(row.limitAmt) : `${row.limitPct}%`}
                      {!row.registered && <span className="ml-1 text-gray-300 dark:text-gray-600">(기본)</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isMaster && (
                        <div className="flex gap-1.5">
                          <button onClick={() => openEdit(row.bank, row)}
                            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">
                            {row.registered ? '수정' : '등록'}
                          </button>
                          {row.limitId && (
                            <button onClick={() => handleDelete(row.limitId!)}
                              className="text-xs text-red-400 hover:text-red-600">
                              삭제
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totalAmt > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
                    <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">합계</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">
                      {fmtKRW(totalAmt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right text-gray-500 dark:text-gray-400">100%</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* 신규 기관 사전 등록 모달 */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
          onClick={() => setAddOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">거래 금융기관 등록</h3>
              <button onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              운용자금 입력 시 드롭다운에 표시됩니다. 한도는 등록 후 수정 가능합니다.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">기관명 *</label>
                <input type="text" value={addForm.bankName}
                  onChange={e => setAddForm(f => ({ ...f, bankName: e.target.value }))}
                  placeholder="예: KB국민은행"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">기관 구분 *</label>
                <select value={addForm.bankType}
                  onChange={e => setAddForm(f => ({ ...f, bankType: e.target.value as typeof BANK_TYPES[number] }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {BANK_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {addErr && <p className="text-xs text-red-500">{addErr}</p>}
            <div className="flex gap-2">
              <button onClick={() => setAddOpen(false)}
                className="flex-1 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg py-2 hover:bg-gray-50 dark:hover:bg-gray-700">
                취소
              </button>
              <button onClick={handleAddBank}
                className="flex-1 text-sm bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700">
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 기관 등록/한도 설정 모달 */}
      {editBank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
          onClick={() => setEditBank(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {editBank} 설정
              </h3>
              <button onClick={() => setEditBank(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">기관 구분</label>
                <select value={form.bankType}
                  onChange={e => setForm(f => ({ ...f, bankType: e.target.value as typeof BANK_TYPES[number] }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {BANK_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">한도 비율 (%)</label>
                <input type="number" min="1" max="100" step="0.5"
                  value={form.limitPct}
                  onChange={e => setForm(f => ({ ...f, limitPct: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-right dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <p className="text-xs text-gray-400 mt-0.5">규정 §9 기본값: 30%</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">한도 금액 (억원, 미입력 시 비율 적용)</label>
                <input type="number" min="0" step="0.1"
                  value={form.limitAmt}
                  onChange={e => setForm(f => ({ ...f, limitAmt: e.target.value }))}
                  placeholder="직접 지정 시 입력"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-right dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">비고</label>
                <input type="text"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="예: 주거래은행, 특수목적 등"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setEditBank(null)}
                className="flex-1 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg py-2 hover:bg-gray-50 dark:hover:bg-gray-700">
                취소
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 text-sm bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
