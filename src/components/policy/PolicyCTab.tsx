/**
 * 자금정책 C안 — 만기 래더링 차트 + 상품 적정성 체크리스트 (별지2)
 */
import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import { fmtKRW } from '../../lib/format'
import type { InvestmentRecord, LoanRecord } from '../../types'

// ── 1. 만기 래더링 차트 ──────────────────────────────────────────────────────

interface LadderProps {
  investments: InvestmentRecord[]
  loans: LoanRecord[]
}

function getMonthLabel(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface MaturityItem {
  label:   string   // 기관명/상품명
  maturity: string  // 만기일 YYYY-MM-DD
  amount:  number   // 원화 금액
}

interface LadderRow {
  month:       string
  monthKey:    string   // YYYY.MM (원본)
  invest:      number   // 억원
  loan:        number   // 억원
  investItems: MaturityItem[]
  loanItems:   MaturityItem[]
}

function buildLadderData(investments: InvestmentRecord[], loans: LoanRecord[]): LadderRow[] {
  const today = new Date()
  const months: string[] = []
  for (let i = 0; i < 13; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    months.push(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const investMap = new Map<string, number>()
  const loanMap   = new Map<string, number>()
  const investItems = new Map<string, MaturityItem[]>()
  const loanItems   = new Map<string, MaturityItem[]>()
  months.forEach(m => {
    investMap.set(m, 0); loanMap.set(m, 0)
    investItems.set(m, []); loanItems.set(m, [])
  })

  for (const inv of investments) {
    if (!inv.maturity || inv.product === '국채') continue
    const m = getMonthLabel(inv.maturity)
    if (!investMap.has(m)) continue
    investMap.set(m, (investMap.get(m) ?? 0) + (inv.amount || 0))
    investItems.get(m)!.push({
      label:   `${inv.bank} · ${inv.product}`,
      maturity: inv.maturity,
      amount:  inv.amount || 0,
    })
  }
  for (const loan of loans) {
    if (!loan.maturity) continue
    const m = getMonthLabel(loan.maturity)
    if (!loanMap.has(m)) continue
    loanMap.set(m, (loanMap.get(m) ?? 0) + (loan.amount || 0))
    loanItems.get(m)!.push({
      label:   `${loan.lender} · ${loan.type}`,
      maturity: loan.maturity,
      amount:  loan.amount || 0,
    })
  }

  return months.map((m, i) => ({
    month:       i === 0 ? '이번 달' : m.slice(5) + '월',
    monthKey:    m,
    invest:      Math.round((investMap.get(m) ?? 0) / 1e8),
    loan:        Math.round((loanMap.get(m)   ?? 0) / 1e8),
    investItems: investItems.get(m) ?? [],
    loanItems:   loanItems.get(m)   ?? [],
  }))
}

// ── 커스텀 툴팁 ──────────────────────────────────────────────────────────────
function LadderTooltip(props: Record<string, unknown>) {
  try {
    const active  = props.active as boolean | undefined
    const label   = props.label  as string  | undefined
    const payload = props.payload as { payload?: LadderRow }[] | undefined

    if (!active || !payload?.length) return null

    const row = payload[0]?.payload
    if (!row) return null

    const investItems: MaturityItem[] = Array.isArray(row.investItems) ? row.investItems : []
    const loanItems:   MaturityItem[] = Array.isArray(row.loanItems)   ? row.loanItems   : []

    const sortedInvest = [...investItems].sort((a, b) => a.maturity.localeCompare(b.maturity))
    const sortedLoan   = [...loanItems  ].sort((a, b) => a.maturity.localeCompare(b.maturity))

    return (
      <div style={{
        background: 'white', border: '1px solid #e5e7eb',
        borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        padding: '10px 12px', fontSize: 11, minWidth: 220, maxWidth: 300,
      }}>
        <p style={{ fontWeight: 700, color: '#111827', marginBottom: 6 }}>{label}</p>

        {sortedInvest.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <p style={{ color: '#2563eb', fontWeight: 600, marginBottom: 3 }}>운용자금 만기</p>
            {sortedInvest.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ color: '#4b5563', flex: 1, minWidth: 0 }}>
                  <span style={{ color: '#9ca3af', marginRight: 4 }}>{item.maturity}</span>
                  {item.label}
                </span>
                <span style={{ color: '#1d4ed8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {Math.round((item.amount || 0) / 1e8)}억
                </span>
              </div>
            ))}
          </div>
        )}

        {sortedLoan.length > 0 && (
          <div>
            <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: 3 }}>차입금 만기</p>
            {sortedLoan.map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ color: '#4b5563', flex: 1, minWidth: 0 }}>
                  <span style={{ color: '#9ca3af', marginRight: 4 }}>{item.maturity}</span>
                  {item.label}
                </span>
                <span style={{ color: '#b91c1c', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {Math.round((item.amount || 0) / 1e8)}억
                </span>
              </div>
            ))}
          </div>
        )}

        {sortedInvest.length === 0 && sortedLoan.length === 0 && (
          <p style={{ color: '#9ca3af' }}>만기 항목 없음</p>
        )}
      </div>
    )
  } catch {
    return null
  }
}

function MaturityLadder({ investments, loans }: LadderProps) {
  const data = useMemo(() => buildLadderData(investments, loans), [investments, loans])
  const maxVal = Math.max(...data.map(d => Math.max(d.invest, d.loan)), 1)

  // 단일 월 집중 경고: invest + loan > 총합의 40%
  const totalInvest = data.reduce((s, d) => s + d.invest, 0)
  const totalLoan   = data.reduce((s, d) => s + d.loan, 0)
  const warnings    = data.filter(d => (d.invest + d.loan) > (totalInvest + totalLoan) * 0.4)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">만기 래더링 (향후 13개월)</h3>
        {warnings.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 font-medium">
            ⚠ 집중 만기 {warnings.map(w => w.month).join(', ')}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={v => v > 0 ? `${v}억` : ''}
            domain={[0, Math.ceil(maxVal * 1.1)]}
            width={40}
          />
          <Tooltip content={<LadderTooltip />} />
          <Legend
            formatter={v => v === 'invest' ? '운용자금 만기' : '차입금 만기'}
            iconType="square"
            wrapperStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="invest" name="invest" fill="#3b82f6" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.invest > 0 && warnings.some(w => w.month === d.month) ? '#1d4ed8' : '#3b82f6'} />
            ))}
          </Bar>
          <Bar dataKey="loan" name="loan" fill="#ef4444" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.loan > 0 && warnings.some(w => w.month === d.month) ? '#b91c1c' : '#ef4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* 합계 행 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
          <p className="text-xs text-blue-600 dark:text-blue-400">운용자금 만기 합계</p>
          <p className="text-sm font-bold text-blue-800 dark:text-blue-300">{fmtKRW(totalInvest * 1e8)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          <p className="text-xs text-red-600 dark:text-red-400">차입금 만기 합계</p>
          <p className="text-sm font-bold text-red-800 dark:text-red-300">{fmtKRW(totalLoan * 1e8)}</p>
        </div>
      </div>
    </div>
  )
}

// ── 2. 상품 적정성 체크리스트 (별지2) ────────────────────────────────────────

interface CheckItem {
  id:       string
  category: string
  label:    string
  desc:     string
}

const CHECKLIST: CheckItem[] = [
  // § 신용/안전성
  { id: 'credit_aa',     category: '신용·안전성', label: '거래상대방 신용등급 AA- 이상', desc: 'NICE/한국기업평가 기준 장기신용등급' },
  { id: 'principal_guar', category: '신용·안전성', label: '원금 보전 가능 여부 확인',    desc: '원금손실 가능성 없는 상품 우선 선택' },
  { id: 'gov_back',       category: '신용·안전성', label: '정부·공공기관 보증 여부',     desc: '예금보험공사 보호 또는 정부보증 여부' },
  // § 유동성
  { id: 'maturity_1y',   category: '유동성',       label: '만기 1년 이내 원칙',          desc: '예외 시 이사회 승인 필요 (규정 §6)' },
  { id: 'early_exit',    category: '유동성',        label: '중도해지·환매 가능 여부',     desc: '긴급 유동성 필요 시 현금화 가능 여부' },
  { id: 'market_liquidity', category: '유동성',    label: '시장 유동성 충분',             desc: '매도 가능한 2차 시장 존재 여부' },
  // § 수익성
  { id: 'rate_compare',  category: '수익성',        label: '기준금리 대비 수익률 검토',   desc: '한국은행 기준금리 + 가산금리 적정성' },
  { id: 'cost_compare',  category: '수익성',        label: '차입금리 대비 운용금리 양(+)', desc: '운용수익 > 차입비용 여부 확인' },
  // § 한도·집중
  { id: 'limit_30pct',   category: '한도·집중',     label: '기관별 30% 한도 이내 (§9)', desc: '단일 거래상대방 집중 위험 제한' },
  { id: 'fx_hedge',      category: '한도·집중',     label: '외화 운용 시 환헤지 비율 확인', desc: 'FX Target Band 이내, 초과 시 월분할환전' },
  // § 승인
  { id: 'officer_approval', category: '승인',       label: '담당 재무임원 사전 승인',    desc: '운용 실행 전 이메일·메신저 승인 기록' },
  { id: 'minutes',       category: '승인',           label: '의사결정 기록 보관',         desc: '운용위원회 의사록 또는 서면결의서' },
]

interface ChecklistProps {
  isMaster: boolean
}

function ProductChecklist({ isMaster }: ChecklistProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [product, setProduct] = useState('')

  const categories = [...new Set(CHECKLIST.map(c => c.category))]
  const allChecked = checked.size === CHECKLIST.length
  const pct = Math.round((checked.size / CHECKLIST.length) * 100)

  function toggle(id: string) {
    if (!isMaster) return
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function reset() {
    setChecked(new Set())
    setProduct('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          상품 적정성 체크리스트 (별지2)
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-100 dark:bg-slate-700 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${allChecked ? 'bg-green-500' : pct > 60 ? 'bg-blue-500' : 'bg-gray-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-xs font-medium ${allChecked ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-slate-300'}`}>
              {checked.size}/{CHECKLIST.length}
              {allChecked && ' ✓ 충족'}
            </span>
          </div>
          {isMaster && (
            <button onClick={reset} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400">
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 상품명 입력 */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-slate-300 shrink-0">검토 상품</label>
        <input
          type="text"
          value={product}
          onChange={e => setProduct(e.target.value)}
          placeholder="예: KB국민은행 정기예금 3개월"
          disabled={!isMaster}
          className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        />
      </div>

      {/* 카테고리별 체크리스트 */}
      {categories.map(cat => (
        <div key={cat} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
            <span className="text-xs font-semibold text-gray-600 dark:text-slate-100">{cat}</span>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {CHECKLIST.filter(c => c.category === cat).map(item => {
              const isChecked = checked.has(item.id)
              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    isChecked ? 'bg-green-50/50 dark:bg-green-950/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                  } ${!isMaster ? 'cursor-default' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(item.id)}
                    disabled={!isMaster}
                    className="mt-0.5 w-4 h-4 accent-green-600 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isChecked ? 'text-green-700 dark:text-green-400 line-through decoration-green-400' : 'text-gray-800 dark:text-gray-100'}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                  {isChecked && <span className="text-green-500 shrink-0 text-sm">✓</span>}
                </label>
              )
            })}
          </div>
        </div>
      ))}

      {allChecked && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-4 text-center">
          <p className="text-sm font-semibold text-green-700 dark:text-green-300">✓ 모든 적정성 기준 충족</p>
          {product && <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">{product}</p>}
          <p className="text-xs text-green-500 dark:text-green-500 mt-1">운용 실행 전 담당 임원 승인 후 진행하세요.</p>
        </div>
      )}

      {!isMaster && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          체크리스트 작성은 master 계정만 가능합니다.
        </p>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface Props {
  investments: InvestmentRecord[]
  loans:       LoanRecord[]
  isMaster:    boolean
}

export default function PolicyCTab({ investments, loans, isMaster }: Props) {
  const [view, setView] = useState<'ladder' | 'checklist'>('ladder')

  return (
    <div className="space-y-4">
      {/* 서브 탭 */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {([
          { key: 'ladder',    label: '📊 만기 래더링' },
          { key: 'checklist', label: '☑️ 상품 적정성' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              view === t.key
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'ladder' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
          <MaturityLadder investments={investments} loans={loans} />
        </div>
      )}
      {view === 'checklist' && (
        <ProductChecklist isMaster={isMaster} />
      )}
    </div>
  )
}

