/**
 * 자금정책 C안 — 만기 래더링 차트 + 상품 적정성 체크리스트 (별지2)
 */
import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import { fmtKRW, generateUUID } from '../../lib/format'
import { restInsert } from '../../lib/supabase'
import { usePolicyProductReviews, type ProductReview } from '../../hooks/usePolicyProductReviews'
import { usePolicyMeetings } from '../../hooks/usePolicyMeetings'
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
  { id: 'credit_aa',        category: '신용·안전성', label: '거래상대방 신용등급 AA- 이상',     desc: 'NICE/한국기업평가 기준 장기신용등급' },
  { id: 'principal_guar',   category: '신용·안전성', label: '원금 보전 가능 여부 확인',         desc: '원금손실 가능성 없는 상품 우선 선택' },
  { id: 'gov_back',         category: '신용·안전성', label: '정부·공공기관 보증 여부',           desc: '예금보험공사 보호 또는 정부보증 여부' },
  // § 유동성
  { id: 'maturity_1y',      category: '유동성',       label: '만기 1년 이내 원칙',              desc: '예외 시 이사회 승인 필요 (규정 §6)' },
  { id: 'early_exit',       category: '유동성',       label: '중도해지·환매 가능 여부',          desc: '긴급 유동성 필요 시 현금화 가능 여부' },
  { id: 'market_liquidity', category: '유동성',       label: '시장 유동성 충분',                 desc: '매도 가능한 2차 시장 존재 여부' },
  // § 수익성
  { id: 'rate_compare',     category: '수익성',       label: '기준금리 대비 수익률 검토',        desc: '한국은행 기준금리 + 가산금리 적정성' },
  { id: 'cost_compare',     category: '수익성',       label: '차입금리 대비 운용금리 양(+)',      desc: '운용수익 > 차입비용 여부 확인' },
  // § 한도·집중
  { id: 'limit_30pct',      category: '한도·집중',    label: '기관별 30% 한도 이내 (§9)',       desc: '단일 거래상대방 집중 위험 제한' },
  { id: 'fx_hedge',         category: '한도·집중',    label: '외화 운용 시 환헤지 비율 확인',    desc: 'FX Target Band 이내, 초과 시 월분할환전' },
  // § 승인
  { id: 'officer_approval', category: '승인',         label: '담당 재무임원 사전 승인',          desc: '운용 실행 전 이메일·메신저 승인 기록' },
  { id: 'minutes',          category: '승인',         label: '의사결정 기록 보관',               desc: '운용위원회 의사록 또는 서면결의서' },
]

const VERDICT_META = {
  '적정':   { label: '✅ 적정',   cls: 'bg-green-600 text-white',  badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  '조건부': { label: '⚠️ 조건부', cls: 'bg-yellow-500 text-white', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  '부적정': { label: '🚫 부적정', cls: 'bg-red-600 text-white',    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
} as const

type Verdict = keyof typeof VERDICT_META

// ── 의결사항 등록 미니 모달 ──────────────────────────────────────────────────
interface DecisionModalProps {
  review: ProductReview
  company: string
  userLabel: string
  onClose: () => void
  onLinked: (decisionId: string) => void
}

function DecisionModal({ review, company, userLabel, onClose, onLinked }: DecisionModalProps) {
  const meetings = usePolicyMeetings()
  // policy_meetings에는 company 필드가 없으므로 전체 표시
  const companyMeetings = meetings.data
  const [meetingId, setMeetingId] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const preAgenda = `[상품 적정성] ${review.product_name} 검토`
  const preResult = `판정: ${review.verdict}${review.condition_note ? `\n검토 의견: ${review.condition_note}` : ''}\n충족 항목: ${review.checked_items.length}/${CHECKLIST.length}`

  async function handleCreate() {
    if (!meetingId) { setErrMsg('회의를 선택해 주세요'); return }
    setSaving(true)
    setErrMsg('')
    const id = generateUUID()
    const { error: err } = await restInsert('policy_decisions', {
      id,
      meeting_id: meetingId,
      company,
      agenda:     preAgenda,
      result:     preResult,
      assignee:   assignee || null,
      due_date:   dueDate  || null,
      status:     '완료',
      created_by: userLabel,
    })
    setSaving(false)
    if (err) { setErrMsg(err.message); return }
    onLinked(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 w-[480px] max-w-[calc(100vw-2rem)] p-6 space-y-4"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">📋 의결사항으로 등록</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>

        {/* 회의 선택 */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300">연결 회의 *</label>
          {meetings.loading ? (
            <p className="text-xs text-gray-400">회의 목록 로딩 중…</p>
          ) : companyMeetings.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ 등록된 회의가 없습니다. 자금정책 → 회의·의결 탭에서 먼저 회의를 등록해 주세요.
            </p>
          ) : (
            <select
              value={meetingId}
              onChange={e => setMeetingId(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">회의를 선택하세요</option>
              {companyMeetings.map(m => (
                <option key={m.id} value={m.id}>
                  {m.held_at?.slice(0, 10)} — {m.title} ({m.meeting_type})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 안건·결과 미리보기 */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300">안건 (자동입력)</label>
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{preAgenda}</div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-slate-300">결정 내용 (자동입력)</label>
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line">{preResult}</div>
        </div>

        {/* 담당자·기한 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300">담당자</label>
            <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="선택"
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-slate-300">이행 기한</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>

        {errMsg && <p className="text-xs text-red-500">{errMsg}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white">취소</button>
          <button onClick={handleCreate} disabled={saving || !meetingId}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {saving ? '등록 중…' : '의결사항 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 이력 행 ─────────────────────────────────────────────────────────────────
function HistoryRow({
  review, onLoad, onDelete,
}: {
  review: ProductReview
  onLoad: (r: ProductReview) => void
  onDelete: (id: string) => void
}) {
  const meta = VERDICT_META[review.verdict as Verdict] ?? VERDICT_META['조건부']
  const date = review.reviewed_at?.slice(0, 10) ?? ''

  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-100 dark:border-slate-700/50 last:border-0 flex-wrap">
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 w-20">{date}</span>
      <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200 truncate">{review.product_name}</span>
      <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">
        {review.checked_items.length}/{CHECKLIST.length}
      </span>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${meta.badge}`}>
        {review.verdict}
      </span>
      <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">{review.reviewer}</span>
      {review.linked_issue_key && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 shrink-0">이슈↗</span>
      )}
      {review.linked_decision_id && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 shrink-0">의결↗</span>
      )}
      <button onClick={() => onLoad(review)}
        className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 shrink-0 px-1">
        불러오기
      </button>
      <button onClick={() => onDelete(review.id)}
        className="text-xs text-gray-300 hover:text-red-500 dark:hover:text-red-400 shrink-0 px-1">
        삭제
      </button>
    </div>
  )
}

// ── 메인 체크리스트 컴포넌트 ────────────────────────────────────────────────
interface ChecklistProps {
  isMaster:  boolean
  company:   string
  userLabel: string
}

function ProductChecklist({ isMaster, company, userLabel }: ChecklistProps) {
  const reviews   = usePolicyProductReviews(company)

  // 폼 상태
  const [checked,  setChecked]  = useState<Set<string>>(new Set())
  const [product,  setProduct]  = useState('')
  const [verdict,  setVerdict]  = useState<Verdict | null>(null)
  const [note,     setNote]     = useState('')

  // 저장·후속 상태
  const [saving,        setSaving]        = useState(false)
  const [savedReview,   setSavedReview]   = useState<ProductReview | null>(null)
  const [issueLoading,  setIssueLoading]  = useState(false)
  const [issueDone,     setIssueDone]     = useState(false)
  const [decisionModal, setDecisionModal] = useState(false)

  const categories  = [...new Set(CHECKLIST.map(c => c.category))]
  const pct         = Math.round((checked.size / CHECKLIST.length) * 100)
  const unchecked   = CHECKLIST.filter(c => !checked.has(c.id))
  const canSave     = isMaster && product.trim() && verdict !== null

  function toggle(id: string) {
    if (!isMaster) return
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function resetForm() {
    setChecked(new Set())
    setProduct('')
    setVerdict(null)
    setNote('')
    setSavedReview(null)
    setIssueDone(false)
  }

  function loadReview(r: ProductReview) {
    setProduct(r.product_name)
    setChecked(new Set(r.checked_items))
    setVerdict(r.verdict as Verdict)
    setNote(r.condition_note ?? '')
    setSavedReview(r)
    setIssueDone(!!r.linked_issue_key)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    const { error: err, id } = await reviews.save({
      company,
      product_name:   product.trim(),
      checked_items:  [...checked],
      verdict:        verdict!,
      condition_note: note,
      reviewer:       userLabel,
    })
    setSaving(false)
    if (err) { alert('저장 실패: ' + err); return }
    // 저장된 데이터를 reviews.data 에서 찾아 savedReview에 세팅
    const saved: ProductReview = {
      id,
      company,
      product_name:      product.trim(),
      checked_items:     [...checked],
      verdict:           verdict!,
      condition_note:    note,
      reviewer:          userLabel,
      reviewed_at:       new Date().toISOString(),
      linked_issue_key:  null,
      linked_decision_id: null,
    }
    setSavedReview(saved)
    setIssueDone(false)
    // 폼 입력은 유지 (후속조치 버튼 사용을 위해)
  }

  async function handleCreateIssue() {
    if (!savedReview) return
    setIssueLoading(true)
    const uncheckedLabels = CHECKLIST
      .filter(c => !savedReview.checked_items.includes(c.id))
      .map(c => `• ${c.label}`)
      .join('\n')
    const body =
      `[상품 적정성 검토] ${savedReview.product_name}\n` +
      `판정: ${savedReview.verdict}  (${savedReview.checked_items.length}/${CHECKLIST.length} 충족)\n` +
      (savedReview.condition_note ? `사유: ${savedReview.condition_note}\n` : '') +
      (uncheckedLabels ? `\n미충족 항목:\n${uncheckedLabels}` : '')
    const issueKey = `product_review_${savedReview.id}`
    const { error: err } = await restInsert('issue_comments', {
      id:         generateUUID(),
      company,
      issue_key:  issueKey,
      body,
      status:     'open',
      user_label: userLabel,
    })
    if (!err) {
      await reviews.linkIssue(savedReview.id, issueKey)
      setSavedReview(prev => prev ? { ...prev, linked_issue_key: issueKey } : prev)
      setIssueDone(true)
    } else {
      alert('이슈 등록 실패: ' + err.message)
    }
    setIssueLoading(false)
  }

  async function handleDeleteReview(id: string) {
    if (!confirm('검토 이력을 삭제하시겠습니까?')) return
    await reviews.remove(id)
    if (savedReview?.id === id) setSavedReview(null)
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          상품 적정성 체크리스트 (별지2)
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-100 dark:bg-slate-700 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${checked.size === CHECKLIST.length ? 'bg-green-500' : pct > 60 ? 'bg-blue-500' : 'bg-gray-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-xs font-medium ${checked.size === CHECKLIST.length ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-slate-300'}`}>
              {checked.size}/{CHECKLIST.length}
            </span>
          </div>
          {isMaster && (
            <button onClick={resetForm} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400">
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
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    isChecked ? 'bg-green-50/50 dark:bg-green-950/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                  } ${isMaster ? 'cursor-pointer' : 'cursor-default'}`}
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

      {/* ── 판정 섹션 ── */}
      {isMaster && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 dark:text-slate-300">판정 결과</p>

          {/* 미충족 항목 요약 */}
          {unchecked.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">
                미충족 항목 {unchecked.length}개
              </p>
              <ul className="space-y-0.5">
                {unchecked.map(c => (
                  <li key={c.id} className="text-xs text-amber-600 dark:text-amber-500">• {c.label}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 판정 버튼 */}
          <div className="flex gap-2 flex-wrap">
            {(['적정', '조건부', '부적정'] as const).map(v => (
              <button
                key={v}
                onClick={() => setVerdict(verdict === v ? null : v)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  verdict === v
                    ? VERDICT_META[v].cls + ' border-transparent shadow-sm'
                    : 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-slate-500'
                }`}
              >
                {VERDICT_META[v].label}
              </button>
            ))}
          </div>

          {/* 조건부·부적정 사유 */}
          {(verdict === '조건부' || verdict === '부적정') && (
            <div className="space-y-1">
              <label className="text-xs text-gray-500 dark:text-slate-400">
                {verdict === '조건부' ? '조건 / 이행 요건' : '부적정 사유'}
                <span className="text-red-400 ml-1">*</span>
              </label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder={verdict === '조건부' ? '예: 만기 6개월 이하 조건, 기관 한도 사전 확인 필요' : '예: 신용등급 BBB, 원금손실 위험'}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>
          )}

          {/* 저장 버튼 */}
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 bg-blue-600 hover:bg-blue-700 text-white disabled:cursor-not-allowed"
          >
            {saving ? '저장 중…' : verdict ? `${VERDICT_META[verdict].label} 판정 저장` : '판정 후 저장'}
          </button>
        </div>
      )}

      {/* ── 저장 완료 후: 후속조치 패널 ── */}
      {savedReview && (
        <div className={`rounded-xl border p-4 space-y-3 ${
          savedReview.verdict === '부적정'
            ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
            : savedReview.verdict === '조건부'
            ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
            : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${
                savedReview.verdict === '부적정' ? 'text-red-700 dark:text-red-300'
                : savedReview.verdict === '조건부' ? 'text-yellow-700 dark:text-yellow-300'
                : 'text-green-700 dark:text-green-300'
              }`}>
                ✔ 검토 완료 — {savedReview.product_name}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {savedReview.checked_items.length}/{CHECKLIST.length} 충족 · {savedReview.verdict}
                {savedReview.condition_note ? ` · ${savedReview.condition_note}` : ''}
              </p>
            </div>
          </div>

          <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 mt-1">후속 조치</div>
          <div className="flex flex-wrap gap-2">
            {/* 부적정: 이슈 등록 */}
            {savedReview.verdict === '부적정' && (
              issueDone || savedReview.linked_issue_key ? (
                <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-sm">
                  ✓ 이슈 등록 완료
                </span>
              ) : (
                <button
                  onClick={handleCreateIssue}
                  disabled={issueLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {issueLoading ? '등록 중…' : '🚨 이슈 등록'}
                </button>
              )
            )}

            {/* 적정·조건부: 의결사항 등록 */}
            {(savedReview.verdict === '적정' || savedReview.verdict === '조건부') && (
              savedReview.linked_decision_id ? (
                <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-sm">
                  ✓ 의결사항 연결 완료
                </span>
              ) : (
                <button
                  onClick={() => setDecisionModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                >
                  📋 의결사항으로 등록
                </button>
              )
            )}

            {/* 새 검토 시작 */}
            <button
              onClick={resetForm}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white text-sm transition-colors"
            >
              새 검토 시작
            </button>
          </div>
        </div>
      )}

      {!isMaster && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          체크리스트 작성·저장은 master 계정만 가능합니다.
        </p>
      )}

      {/* ── 검토 이력 ── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-600 dark:text-slate-200">최근 검토 이력</span>
          {reviews.loading && <span className="text-xs text-gray-400">로딩 중…</span>}
        </div>
        <div className="px-4">
          {reviews.data.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 py-3 text-center">검토 이력이 없습니다.</p>
          ) : (
            reviews.data.map(r => (
              <HistoryRow
                key={r.id}
                review={r}
                onLoad={loadReview}
                onDelete={handleDeleteReview}
              />
            ))
          )}
        </div>
      </div>

      {/* 의결사항 등록 모달 */}
      {decisionModal && savedReview && (
        <DecisionModal
          review={savedReview}
          company={company}
          userLabel={userLabel}
          onClose={() => setDecisionModal(false)}
          onLinked={async (decisionId) => {
            await reviews.linkDecision(savedReview.id, decisionId)
            setSavedReview(prev => prev ? { ...prev, linked_decision_id: decisionId } : prev)
          }}
        />
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface Props {
  investments: InvestmentRecord[]
  loans:       LoanRecord[]
  isMaster:    boolean
  company:     string
  userLabel:   string
}

export default function PolicyCTab({ investments, loans, isMaster, company, userLabel }: Props) {
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
        <ProductChecklist isMaster={isMaster} company={company} userLabel={userLabel} />
      )}
    </div>
  )
}

