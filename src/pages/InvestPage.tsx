import { useState, useEffect, useMemo, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useInvestments } from '../hooks/useInvestments'
import { usePolicyBankLimits } from '../hooks/usePolicyBankLimits'
import { useFx } from '../hooks/useFx'
import { usePageCompany } from '../hooks/usePageCompany'
import { useToast } from '../contexts/ToastProvider'
import { useNegoLogs } from '../hooks/useNegoLogs'
import { toKRWAmount } from '../lib/treasuryCalc'
import { fmtKRW, calcDday, fmtReturn, returnBadgeClass, calcReturn } from '../lib/format'
import { NumInput } from '../components/common/NumInput'
import NegoLogPanel from '../components/common/NegoLogPanel'
import AvailabilityModal, { type AvailItem } from '../components/common/AvailabilityModal'
import CloseDateModal from '../components/common/CloseDateModal'
import { INVEST_PRODUCTS } from '../lib/investProducts'
import RolloverModal, { type RolloverValues } from '../components/common/RolloverModal'
import { fetchFxLots, settleFxTermDeposit, linkFxLotsToInvestment } from '../hooks/useFxLots'
import type { FxLot } from '../lib/fxLots'
import { ACCOUNT_TYPE_LABEL } from '../lib/fxLots'
import {
  isFxTermDeposit, planRolloverLedger, planCloseLedger, termStateAt, isPlanError,
} from '../lib/fxTermSettle'
import type { InvestmentRecord } from '../types'

// 상품유형은 lib/investProducts.ts 가 정본이다(연동 팝업과 공유)
const CURRENCY_OPTIONS = ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY']

const EMPTY_FORM = {
  bank: '',
  product: '정기예금',
  currency: 'KRW',
  amount: '',
  available: '가용' as '가용' | '불가용',
  rate: '',
  start: new Date().toISOString().slice(0, 10),
  maturity: '',
  acquisition_cost: '',
}

type FormState = typeof EMPTY_FORM

export default function InvestPage() {
  const { id: paramId } = useParams<{ id?: string }>()
  const auth = useAuth()
  const { canEdit, canAction } = auth
  const { company: currentCompany } = usePageCompany()
  const toast = useToast()
  const invest = useInvestments(false, currentCompany)
  const fx = useFx()
  const bankMaster = usePolicyBankLimits(currentCompany)

  const [tab, setTab]           = useState<'active' | 'inactive'>('active')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId]     = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)
  const [negoId, setNegoId]     = useState<string | null>(null)
  const [availModalOpen, setAvailModalOpen] = useState(false)

  const nego = useNegoLogs(currentCompany, 'investment')

  useEffect(() => { void fx.fetchRates() }, [fx.fetchRates])

  useEffect(() => {
    if (!paramId || !invest.nonBonds.length) return
    const rec = invest.nonBonds.find(r => r.id === paramId)
    if (rec) loadRecord(rec)
  }, [paramId, invest.nonBonds])

  const activeList   = useMemo(() => invest.nonBonds.filter(r => r.active),  [invest.nonBonds])
  const inactiveList = useMemo(() => invest.nonBonds.filter(r => !r.active), [invest.nonBonds])
  const displayList  = tab === 'active' ? activeList : inactiveList

  const hasFxInvest = useMemo(() => activeList.some(r => r.currency && r.currency !== 'KRW'), [activeList])

  const availInvestItems = useMemo<AvailItem[]>(() =>
    activeList.map(r => ({
      key:      r.id,
      label:    `${r.bank} ${r.product}`,
      sublabel: r.currency !== 'KRW' ? `${r.amount.toLocaleString()} ${r.currency}` : undefined,
      detail:   r.maturity ? `만기 ${r.maturity}` : undefined,
      current:  r.available ?? '가용',
    })),
  [activeList])

  async function handleAvailInvestSave(changes: { key: string; available: '가용' | '불가용' }[]) {
    for (const ch of changes) {
      const err = await invest.updateAvailableById(ch.key, ch.available)
      if (err) toast.error(`항목 ${ch.key}: ${err}`)
    }
    toast.success(`${changes.length}건 가용현황 변경 완료`)
  }
  const fxLoading = hasFxInvest && fx.rates.length === 0

  const toKRWAmt = (amount: number, currency: string) => toKRWAmount(amount, currency, fx.toKRW)
  const totalAvail   = useMemo(() => activeList.filter(r => r.available === '가용')  .reduce((s, r) => s + toKRWAmt(r.amount, r.currency), 0), [activeList, fx.toKRW])  // eslint-disable-line react-hooks/exhaustive-deps
  const totalUnavail = useMemo(() => activeList.filter(r => r.available === '불가용').reduce((s, r) => s + toKRWAmt(r.amount, r.currency), 0), [activeList, fx.toKRW])  // eslint-disable-line react-hooks/exhaustive-deps

  // 금액 표시: KRW는 fmtKRW, 외화는 "N만 CCY (≈KRW환산)" 형태
  function fmtAmtDisplay(amount: number, currency: string): { primary: string; sub: string | null } {
    if (!currency || currency === 'KRW') return { primary: fmtKRW(amount), sub: null }
    const native = amount >= 10000
      ? `${(amount / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만 ${currency}`
      : `${amount.toLocaleString('ko-KR')} ${currency}`
    const krw = toKRWAmt(amount, currency)
    const sub = krw > 0 ? `≈${fmtKRW(krw)}` : null
    return { primary: native, sub }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function loadRecord(rec: InvestmentRecord) {
    setEditId(rec.id)
    setForm({
      bank:             rec.bank,
      product:          rec.product,
      currency:         rec.currency,
      amount:           String(rec.amount || ''),
      available:        rec.available,
      rate:             String(rec.rate || ''),
      start:            rec.start || '',
      maturity:         rec.maturity || '',
      acquisition_cost: String(rec.acquisition_cost || ''),
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(false)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentCompany) return
    setSaving(true)
    setError(null)
    const record = {
      ...(editId ? { id: editId } : {}),
      company:          currentCompany,
      bank:             form.bank,
      product:          form.product,
      currency:         form.currency,
      amount:           Number(form.amount) || 0,
      available:        form.available,
      rate:             Number(form.rate)   || 0,
      start:            form.start,
      maturity:         form.maturity,
      active:           true,
      acquisition_cost: Number(form.acquisition_cost) || 0,
    }
    const err = await invest.save(record)
    setSaving(false)
    if (err) { setError(err); toast.error(`운용자금 저장 실패: ${err}`); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
    toast.success(editId ? '운용자금이 수정되었습니다' : '운용자금이 등록되었습니다')
    resetForm()
  }

  // 만기처리는 실제 해지일을 받아야 한다 — 그 날짜로 자금일보 자금현황의 출금·마감이 갈린다
  const [closeTarget, setCloseTarget] = useState<{ id: string; label: string; active: boolean } | null>(null)
  const [closeDate,   setCloseDate]   = useState(new Date().toISOString().slice(0, 10))
  const [closeBusy,   setCloseBusy]   = useState(false)

  /**
   * 외화 정기예금 원장 연동 (2026-09-15)
   *
   * ⭐ 왜 여기인가. 정기예금은 investments 와 fx_lots **두 장부에 동시에 존재**하는데,
   *   실무자는 운용자금 화면에서만 만기·재예치를 처리한다(외화거래명세는 메뉴 권한이
   *   따로 있어 경로 자체가 없는 계정도 있다). 그러면 원장에는 만기 지난 정기예금이
   *   남아 **환전 가능액이 과소 계산**되고 리짐 권고액까지 어긋난다.
   *   → 운용자금 처리 한 번으로 원장까지 반영한다.
   *
   * ⚠ 두 장부를 하나의 트랜잭션으로 묶을 수는 없다(한쪽은 테이블 쓰기, 한쪽은 RPC).
   *   그래서 **운용자금을 먼저** 처리하고 원장을 뒤에 반영한다 — 원장이 실패해도
   *   운용자금은 화면에서 되돌릴 수 있고, 실패 사실을 정확히 알려 수동 반영을 유도한다.
   */
  const [ledgerLots, setLedgerLots] = useState<FxLot[] | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)

  // 모달을 열 때 그 통화의 로트를 1회 조회한다(통화가 행마다 달라 훅을 쓸 수 없다)
  async function loadLedgerLots(rec: InvestmentRecord) {
    setLedgerLots(null)
    if (!isFxTermDeposit(rec)) return
    setLedgerLoading(true)
    const { lots, error: err } = await fetchFxLots(currentCompany, rec.currency)
    setLedgerLoading(false)
    if (err) { setLedgerLots(null); toast.error(`원장 잔액 조회 실패: ${err}`); return }
    setLedgerLots(lots)
  }

  /** 원장 반영 — 성공하면 새 운용자금 건에 로트를 연결해 두 장부가 서로를 참조하게 한다 */
  async function applyLedgerSettle(
    rec: InvestmentRecord,
    plan: ReturnType<typeof planCloseLedger>,
    settleDate: string, interestRate: number, linkInvestmentId: string | null,
  ): Promise<string | null> {
    if (isPlanError(plan)) return plan.error
    const err = await settleFxTermDeposit(currentCompany, rec.currency, {
      date: settleDate,
      principal: plan.plan.principal,
      toAccountType: plan.plan.toAccountType,
      interest: plan.plan.interest,
      interestRate: plan.plan.interest > 0 ? interestRate : null,
      interestAccountType: plan.plan.interestAccountType,
      maturityDate: plan.plan.maturityDate,
      annualInterestRate: plan.plan.annualInterestRate,
      transferRate: null,
      allowEarly: plan.plan.allowEarly,
      investmentId: linkInvestmentId,
      memo: `${rec.bank} ${rec.currency} 정기예금 — 운용자금 연동`,
      userCode: auth.user?.code ?? 'unknown',
    })
    if (err) return err
    // 연결은 서버가 신규 로트에 이미 넣지만, 소진되지 않고 남은 기존 로트(부분 해지 등)는
    // 여전히 미연결이다. 실패해도 해지 자체는 유효하므로 오류로 올리지 않는다.
    if (linkInvestmentId && ledgerLots) {
      const unlinked = ledgerLots.filter(l => l.accountType === 'term_deposit' && !l.investmentId)
      if (unlinked.length) void linkFxLotsToInvestment(unlinked.map(l => l.id), linkInvestmentId, auth.user?.code ?? 'unknown')
    }
    return null
  }

  function handleSetActive(rec: InvestmentRecord, active: boolean) {
    setCloseDate(new Date().toISOString().slice(0, 10))
    setCloseSync(true); setCloseInterest(''); setCloseRate(''); setCloseTo('demand_deposit')
    setCloseRecord(active ? null : rec)
    setLedgerLots(null)
    if (!active) void loadLedgerLots(rec)
    setCloseTarget({
      id: rec.id, active,
      label: `${rec.bank} ${rec.product} ${(rec.amount ?? 0).toLocaleString()}${rec.currency && rec.currency !== 'KRW' ? ` ${rec.currency}` : '원'}`,
    })
  }

  // 만기처리 시 원장 연동 입력
  const [closeRecord,   setCloseRecord]   = useState<InvestmentRecord | null>(null)
  const [closeSync,     setCloseSync]     = useState(true)
  const [closeTo,       setCloseTo]       = useState<'demand_deposit' | 'mmda'>('demand_deposit')
  const [closeInterest, setCloseInterest] = useState('')
  const [closeRate,     setCloseRate]     = useState('')

  // 계산은 순수 함수 하나에만 둔다(lib/fxTermSettle.ts)
  const closeLedgerPlan = useMemo(() => {
    if (!closeRecord || !ledgerLots) return null
    return planCloseLedger(closeRecord,
      { closeDate, toAccountType: closeTo, interest: Number(closeInterest) || 0 },
      termStateAt(ledgerLots, closeDate))
  }, [closeRecord, ledgerLots, closeDate, closeTo, closeInterest])
  const closeNeedsRate = !!closeLedgerPlan && !isPlanError(closeLedgerPlan) && closeLedgerPlan.plan.interest > 0

  // 연장 — 기존 건을 수정하지 않고 종료 + 신규로 처리해 과거를 보존한다
  const [rolloverTarget, setRolloverTarget] = useState<InvestmentRecord | null>(null)
  const [rolloverBusy,   setRolloverBusy]   = useState(false)

  async function confirmRollover(v: RolloverValues) {
    if (!rolloverTarget) return
    const rec = rolloverTarget
    setRolloverBusy(true)
    // ① 운용자금 먼저 — 원장이 실패해도 이쪽은 화면에서 되돌릴 수 있다
    const { error: err, newId } = await invest.rollover(rec.id, v)
    if (err) { setRolloverBusy(false); toast.error(`연장 실패: ${err}`); return }

    // ② 원장 반영 — 체크를 껐거나 외화 정기예금이 아니면 건너뛴다
    let ledgerNote = ''
    if (v.syncLedger && !ledgerLots) {
      // 로트 조회가 실패한 상태 — 조용히 넘기면 두 장부가 벌어진 줄 모른다
      ledgerNote = ' · ⚠ 원장 잔액을 읽지 못해 반영하지 못했습니다'
    } else if (v.syncLedger && ledgerLots) {
      const plan = planRolloverLedger(rec, v, termStateAt(ledgerLots, v.closeDate))
      const lErr = await applyLedgerSettle(rec, plan, v.closeDate, v.interestRate ?? 0, newId)
      if (lErr) {
        setRolloverBusy(false); setRolloverTarget(null)
        toast.error(`연장은 완료됐지만 외화 원장 반영에 실패했습니다: ${lErr} — 외화거래명세 › 데이터 등록에서 직접 해지하세요.`)
        return
      }
      ledgerNote = ' · 외화 원장 반영 완료'
    }
    setRolloverBusy(false)
    toast.success(`연장 완료 — ${v.closeDate} 종료, ${v.newMaturity}까지 신규 등록${ledgerNote}`)
    setRolloverTarget(null)
  }

  async function confirmSetActive() {
    if (!closeTarget) return
    setCloseBusy(true)
    const err = await invest.setActive(closeTarget.id, closeTarget.active, closeTarget.active ? undefined : closeDate)
    if (err) { setCloseBusy(false); toast.error(`처리 실패: ${err}`); setCloseTarget(null); return }

    if (!closeTarget.active && closeSync && closeRecord && ledgerLots) {
      const plan = planCloseLedger(closeRecord,
        { closeDate, toAccountType: closeTo, interest: Number(closeInterest) || 0 },
        termStateAt(ledgerLots, closeDate))
      const lErr = await applyLedgerSettle(closeRecord, plan, closeDate,
        Number(closeRate) || toKRWAmount(1, closeRecord.currency, fx.toKRW), null)
      setCloseBusy(false); setCloseTarget(null)
      if (lErr) toast.error(`만기처리는 완료됐지만 외화 원장 반영에 실패했습니다: ${lErr} — 외화거래명세 › 데이터 등록에서 직접 해지하세요.`)
      else toast.success('만기처리 · 외화 원장 반영 완료')
      return
    }
    setCloseBusy(false)
    setCloseTarget(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return
    await invest.remove(id)
  }

  const isEditable = canEdit() && canAction('invest', 'write')

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">운용자금</h2>
        {isEditable && !showForm && (
          <div className="flex items-center gap-2">
            {tab === 'active' && (
              <button
                onClick={() => setAvailModalOpen(true)}
                className="text-sm border border-indigo-200 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
              >
                🔄 가용현황 변경
              </button>
            )}
            <button onClick={() => setShowForm(true)}
              className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
              + 신규 등록
            </button>
          </div>
        )}
      </div>

      {/* KPI 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 dark:bg-blue-950/30 dark:border-blue-800">
          <p className="text-xs text-blue-600 font-medium mb-1 dark:text-blue-400">가용 합계</p>
          <p className="text-xl font-bold text-blue-800 dark:text-blue-300">
            {fxLoading ? <span className="text-sm animate-pulse">환율 조회 중…</span> : fmtKRW(totalAvail)}
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 dark:bg-slate-800 dark:border-slate-700">
          <p className="text-xs text-gray-500 font-medium mb-1 dark:text-slate-300">불가용 합계</p>
          <p className="text-xl font-bold text-gray-700 dark:text-gray-200">
            {fxLoading ? <span className="text-sm animate-pulse">환율 조회 중…</span> : fmtKRW(totalUnavail)}
          </p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-emerald-50 border border-emerald-200 rounded-xl p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
          <p className="text-xs text-emerald-600 font-medium mb-1 dark:text-emerald-400">총 운용 합계</p>
          <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300">
            {fxLoading ? <span className="text-sm animate-pulse">환율 조회 중…</span> : fmtKRW(totalAvail + totalUnavail)}
          </p>
        </div>
      </div>

      {/* 입력 폼 */}
      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 space-y-5 dark:bg-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {editId ? '✏️ 수정 중' : '+ 신규 등록'}
            </h3>
            <button type="button" onClick={resetForm}
              className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500">취소</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">
                금융기관 *
                {bankMaster.data.length > 0 && (
                  <span className="ml-1 text-gray-400 font-normal">({bankMaster.data.length}개 등록)</span>
                )}
              </label>
              {/* datalist: 자금정책 → 기관한도에 등록된 기관 목록 자동완성 */}
              <datalist id="bank-master-list">
                {bankMaster.data.map(b => (
                  <option key={b.id} value={b.bank_name}>{b.bank_type}</option>
                ))}
              </datalist>
              <input type="text" list="bank-master-list"
                value={form.bank} onChange={e => setField('bank', e.target.value)}
                required placeholder="기관명 입력 또는 선택"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
              {bankMaster.data.length === 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  자금정책 → 기관한도 탭에서 거래 금융기관을 먼저 등록하면 여기서 선택할 수 있습니다.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">상품유형 *</label>
              <select value={form.product} onChange={e => setField('product', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {INVEST_PRODUCTS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">통화</label>
              <select value={form.currency} onChange={e => setField('currency', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                {CURRENCY_OPTIONS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">금액 *</label>
              <NumInput value={form.amount} onChange={raw => setField('amount', raw)}
                required placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">수익률 (%)</label>
              <input type="number" step="0.01" value={form.rate} onChange={e => setField('rate', e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">가용 여부</label>
              <select value={form.available} onChange={e => setField('available', e.target.value as '가용' | '불가용')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                <option value="가용">가용</option>
                <option value="불가용">불가용</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">시작일</label>
              <input type="date" value={form.start} onChange={e => setField('start', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">만기일 *</label>
              <input type="date" value={form.maturity} onChange={e => setField('maturity', e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 dark:text-slate-300">취득가액</label>
              <NumInput value={form.acquisition_cost} onChange={raw => setField('acquisition_cost', raw)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
            </div>
          </div>

          {form.amount && form.acquisition_cost && Number(form.acquisition_cost) > 0 && (() => {
            const ret = calcReturn(Number(form.amount), Number(form.acquisition_cost))
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-slate-300">수익률:</span>
                <span className={`text-sm px-2 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>
                  {fmtReturn(ret)}
                </span>
              </div>
            )
          })()}

          {error   && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">✓ 저장되었습니다.</p>}

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : editId ? '수정 저장' : '등록'}
          </button>
        </form>
      )}

      {/* FVPL 이관 안내 */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
        📊 <strong>변동성 리스크 분석</strong>은 <strong>자금정책 관리 → 변동성 리스크 탭</strong>에서 확인하세요.
      </div>

      {/* 탭 + 목록 */}
      <div className="bg-white rounded-xl shadow dark:bg-slate-800">
        <div className="flex border-b border-gray-100 dark:border-slate-700">
          {[
            { key: 'active',   label: `운용 중 (${activeList.length})` },
            { key: 'inactive', label: `만기/종료 (${inactiveList.length})` },
          ].map(t => (
            <button key={t.key}
              onClick={() => setTab(t.key as 'active' | 'inactive')}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 dark:text-slate-300 dark:hover:text-gray-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 md:p-5">
          {invest.loading ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">로딩 중...</p>
          ) : displayList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6 dark:text-gray-500">데이터가 없습니다.</p>
          ) : (
            <>
              {/* 모바일 카드 리스트 */}
              <div className="md:hidden space-y-3">
                {displayList.map(rec => {
                  const dday = calcDday(rec.maturity)
                  const ret  = calcReturn(rec.amount, rec.acquisition_cost)
                  const urgent = tab === 'active' && dday <= 7
                  const warn   = tab === 'active' && dday > 7 && dday <= 30
                  return (
                    <div key={rec.id}
                      className={`rounded-xl border p-4 ${
                        urgent ? 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
                        : warn  ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800'
                        : 'border-gray-200 dark:border-slate-700'
                      }`}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{rec.bank}</span>
                            <span className="text-xs text-gray-500 dark:text-slate-300">{rec.product}</span>
                          </div>
                          <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rec.available === '가용' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300'}`}>{rec.available}</span>
                            {rec.currency !== 'KRW' && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{rec.currency}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          {(() => { const { primary, sub } = fmtAmtDisplay(rec.amount, rec.currency); return (
                            <>
                              <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{primary}</div>
                              {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{sub}</div>}
                            </>
                          ) })()}
                          {tab === 'active' && (
                            <div className={`text-xs font-semibold mt-0.5 ${urgent ? 'text-red-600 dark:text-red-400' : warn ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              D-{dday}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">금리</span><span className="text-gray-700 dark:text-gray-200">{rec.rate ? `${rec.rate}%` : '-'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">만기일</span><span className={`${urgent ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{rec.maturity}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400 dark:text-gray-500">시작일</span><span className="text-gray-700 dark:text-gray-200">{rec.start}</span></div>
                        {ret !== null && (
                          <div className="flex justify-between items-center"><span className="text-gray-400 dark:text-gray-500">수익률</span><span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span></div>
                        )}
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                        {isEditable && (
                          <>
                            <button onClick={() => loadRecord(rec)} className="flex-1 text-xs text-blue-600 dark:text-blue-400 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100">수정</button>
                            {tab === 'active' && rec.product !== '국채' && (
                              <button onClick={() => { setRolloverTarget(rec); void loadLedgerLots(rec) }}
                                title="기존 건을 종료하고 새 건을 만듭니다 — 과거 잔액이 보존됩니다"
                                className="flex-1 text-xs text-indigo-600 dark:text-indigo-400 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100">연장</button>
                            )}
                            {tab === 'active'
                              ? <button onClick={() => handleSetActive(rec, false)} className="flex-1 text-xs text-amber-600 dark:text-amber-400 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100">만기처리</button>
                              : <button onClick={() => handleSetActive(rec, true)} className="flex-1 text-xs text-emerald-600 dark:text-emerald-400 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100">복원</button>
                            }
                            <button onClick={() => handleDelete(rec.id)} className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20">삭제</button>
                          </>
                        )}
                        <button
                          onClick={() => setNegoId(id => id === rec.id ? null : rec.id)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            negoId === rec.id
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400'
                          }`}>
                          💬 {nego.byRecord.get(rec.id)?.length ?? 0}
                        </button>
                      </div>
                      {negoId === rec.id && (
                        <div className="mt-3 -mx-4 -mb-4 rounded-b-xl overflow-hidden">
                          <NegoLogPanel
                            logs={nego.byRecord.get(rec.id) ?? []}
                            company={currentCompany ?? ''}
                            recordType="investment"
                            recordId={rec.id}
                            contextLabel={`${rec.bank} · ${rec.product} · 만기 ${rec.maturity}`}
                            userLabel={auth.user?.label ?? ''}
                            canEdit={isEditable}
                            onAdd={nego.add}
                            onUpdate={nego.update}
                            onRemove={nego.remove}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* PC 테이블 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700">
                      {['금융기관', '상품', '통화', '금액', '수익률', '가용', '시작일', '만기일', 'D-day', ''].map(h => (
                        <th key={h} className="text-left text-xs text-gray-400 font-medium pb-2 pr-3 whitespace-nowrap dark:text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayList.map(rec => {
                      const dday = calcDday(rec.maturity)
                      const ret  = calcReturn(rec.amount, rec.acquisition_cost)
                      const urgent = tab === 'active' && dday <= 30
                      const negoLogs = nego.byRecord.get(rec.id) ?? []
                      const isOpen   = negoId === rec.id
                      return (
                        <Fragment key={rec.id}>
                          <tr className={`border-b border-gray-50 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700 ${urgent ? 'bg-red-50 dark:bg-red-950/20' : ''} ${isOpen ? '!bg-blue-50/40 dark:!bg-slate-800/80' : ''}`}>
                            <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap dark:text-gray-100">{rec.bank}</td>
                            <td className="py-2 pr-3 text-gray-600 dark:text-slate-100">{rec.product}</td>
                            <td className="py-2 pr-3 text-gray-500 dark:text-slate-300">{rec.currency}</td>
                            <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-800 dark:text-gray-100">
                              {(() => { const { primary, sub } = fmtAmtDisplay(rec.amount, rec.currency); return (
                                <><div>{primary}</div>{sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</div>}</>
                              ) })()}
                            </td>
                            <td className="py-2 pr-3">{ret !== null ? <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(ret)}`}>{fmtReturn(ret)}</span> : <span className="text-xs text-gray-400 dark:text-gray-500">{rec.rate ? `${rec.rate}%` : '-'}</span>}</td>
                            <td className="py-2 pr-3"><span className={`text-xs px-1.5 rounded ${rec.available === '가용' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{rec.available}</span></td>
                            <td className="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap dark:text-gray-500">{rec.start}</td>
                            <td className="py-2 pr-3 text-xs text-gray-600 whitespace-nowrap dark:text-slate-100">{rec.maturity}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{tab === 'active' && <span className={`text-xs font-medium ${dday <= 7 ? 'text-red-600' : dday <= 30 ? 'text-amber-600' : 'text-gray-500'}`}>D-{dday}</span>}</td>
                            <td className="py-2 whitespace-nowrap">
                              <div className="flex gap-1.5 items-center">
                                {isEditable && (
                                  <>
                                    <button onClick={() => loadRecord(rec)} className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                                    {tab === 'active' && rec.product !== '국채' && (
                                      <button onClick={() => { setRolloverTarget(rec); void loadLedgerLots(rec) }} className="text-xs text-indigo-500 hover:text-indigo-700" title="종료 + 신규로 연장">연장</button>
                                    )}
                                    {tab === 'active' ? <button onClick={() => handleSetActive(rec, false)} className="text-xs text-amber-500 hover:text-amber-700">만기</button> : <button onClick={() => handleSetActive(rec, true)} className="text-xs text-emerald-500 hover:text-emerald-700">복원</button>}
                                    <button onClick={() => handleDelete(rec.id)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                                  </>
                                )}
                                <button
                                  onClick={() => setNegoId(id => id === rec.id ? null : rec.id)}
                                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                                    isOpen
                                      ? 'bg-blue-600 text-white border-blue-600'
                                      : negoLogs.length > 0
                                        ? 'border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400'
                                        : 'border-gray-200 text-gray-400 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-500'
                                  }`}>
                                  💬{negoLogs.length > 0 ? ` ${negoLogs.length}` : ''}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr key={`${rec.id}-nego`}>
                              <td colSpan={10} className="p-0">
                                <NegoLogPanel
                                  logs={negoLogs}
                                  company={currentCompany ?? ''}
                                  recordType="investment"
                                  recordId={rec.id}
                                  contextLabel={`${rec.bank} · ${rec.product} · 만기 ${rec.maturity}`}
                                  userLabel={auth.user?.label ?? ''}
                                  canEdit={isEditable}
                                  onAdd={nego.add}
                                  onUpdate={nego.update}
                                  onRemove={nego.remove}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── 가용/불가용 일괄변경 모달 ─── */}
      <AvailabilityModal
        open={availModalOpen}
        onClose={() => setAvailModalOpen(false)}
        title="운용자금 가용현황 변경"
        items={availInvestItems}
        onSave={handleAvailInvestSave}
      />

      {rolloverTarget && (
        <RolloverModal
          record={rolloverTarget}
          busy={rolloverBusy}
          ledgerLots={ledgerLots}
          ledgerLoading={ledgerLoading}
          defaultRate={toKRWAmount(1, rolloverTarget.currency, fx.toKRW)}
          onCancel={() => setRolloverTarget(null)}
          onConfirm={v => void confirmRollover(v)}
        />
      )}

      {closeTarget && (
        <CloseDateModal
          title={closeTarget.active ? '운용자금 복원' : '만기 처리'}
          recordLabel={closeTarget.label}
          dateless={closeTarget.active}
          date={closeDate}
          onDateChange={setCloseDate}
          confirmLabel={closeTarget.active ? '복원' : '만기 처리'}
          busy={closeBusy}
          confirmDisabled={closeSync && closeNeedsRate && !(Number(closeRate) > 0 || toKRWAmount(1, closeRecord?.currency, fx.toKRW) > 0)}
          extra={closeRecord && closeLedgerPlan ? (
            /* 외화 정기예금 만기처리 — 원장까지 한 번에. 끄면 외화거래명세에서 따로 해지해야 한다. */
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={closeSync} onChange={e => setCloseSync(e.target.checked)}
                  className="mt-0.5" disabled={ledgerLoading} />
                <span className="text-xs font-medium text-gray-700 dark:text-slate-200">
                  외화거래명세(원장)에도 해지를 함께 반영
                  <span className="block text-[10px] font-normal text-gray-500 dark:text-slate-400">
                    끄면 외화거래명세 › 데이터 등록 › 정기예금 관리에서 따로 해지해야 합니다.
                  </span>
                </span>
              </label>

              {ledgerLoading && <p className="text-[11px] text-gray-400">원장 잔액 확인 중…</p>}

              {closeSync && isPlanError(closeLedgerPlan) && (
                <p className="text-[11px] text-red-600 dark:text-red-400 break-keep">⚠ {closeLedgerPlan.error}</p>
              )}

              {closeSync && !isPlanError(closeLedgerPlan) && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-gray-600 dark:text-slate-300">원금 행선지
                      <select value={closeTo} onChange={e => setCloseTo(e.target.value as 'demand_deposit' | 'mmda')}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs">
                        <option value="demand_deposit">{ACCOUNT_TYPE_LABEL.demand_deposit}</option>
                        <option value="mmda">{ACCOUNT_TYPE_LABEL.mmda}</option>
                      </select>
                    </label>
                    <label className="text-[11px] text-gray-600 dark:text-slate-300">이자 수취액 ({closeRecord.currency})
                      <input type="text" inputMode="decimal" value={closeInterest} onChange={e => setCloseInterest(e.target.value)}
                        placeholder="0"
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs text-right" />
                    </label>
                  </div>
                  {closeNeedsRate && (
                    <label className="block text-[11px] text-gray-600 dark:text-slate-300">이자 장부환율 (해지일 환율)
                      <input type="text" inputMode="decimal" value={closeRate} onChange={e => setCloseRate(e.target.value)}
                        placeholder={String(Math.round((toKRWAmount(1, closeRecord.currency, fx.toKRW)) * 100) / 100)}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs text-right" />
                      <span className="block text-[10px] text-gray-400">이자는 새로 생긴 외화라 원금 장부환율이 아니라 해지일 환율로 잡습니다.</span>
                    </label>
                  )}
                  <ul className="text-[11px] text-gray-600 dark:text-slate-300 space-y-0.5">
                    <li>· 원금 {closeLedgerPlan.plan.principal.toLocaleString()} {closeRecord.currency} → {ACCOUNT_TYPE_LABEL[closeTo]} 대체 (손익 0)</li>
                    {closeLedgerPlan.plan.allowEarly && (
                      <li className="text-amber-600 dark:text-amber-400">· 만기 도래분이 부족해 <strong>중도해지</strong>로 처리됩니다</li>
                    )}
                  </ul>
                  {closeLedgerPlan.warning && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 break-keep">⚠ {closeLedgerPlan.warning}</p>
                  )}
                </>
              )}
            </div>
          ) : undefined}
          onConfirm={confirmSetActive}
          onCancel={() => setCloseTarget(null)}
        />
      )}
    </div>
  )
}

