/**
 * ItemsSection — 입금 또는 출금 라인 아이템 입력 섹션
 *
 * 기능:
 *   - 카테고리 / 계좌구분 / 금액 / 통화 / 메모 입력
 *   - 🔄 자동생성 항목(지분 평가손익) 표시 및 수정
 *   - Δ 셀 클릭 → prefill prop으로 자동 입력 열기
 *   - 💱 외화 항목: 외화계좌(보통예금/MMDA) + 환율 → 외화거래명세 원장 반영 (2026-11-26)
 *       입금 환율 = 장부환율, 출금 환율 = 적용환율(장부환율은 그 계좌 FIFO 로트가 정한다 — 미리보기 표시)
 */
import { useState, useRef, useEffect } from 'react'
import ThreadPopup from './ThreadPopup'
import InvestReturnPopup from './InvestReturnPopup'
import LoanDrawdownPopup from './LoanDrawdownPopup'
import InvestExecutePopup from './InvestExecutePopup'
import LoanRepaymentPopup from './LoanRepaymentPopup'
import { useAuth } from '../../hooks/useAuth'
import type { ReportItem, ThreadEntry } from '../../hooks/useDailyReportItems'
import type { Company, FxCode } from '../../types'

import { ACCOUNT_LABELS, defaultAccountTypeFor } from '../../lib/accountLabels'
import { IN_CATEGORIES, OUT_CATEGORIES } from '../../lib/dailyReportCategories'
import {
  isLedgerCategory, reportItemLedgerState, DUPLICATE_RISK_HINT, NON_LEDGER_CATEGORIES,
  REPORT_ITEM_FX_ACCOUNTS, REPORT_ITEM_FX_ACCOUNT_LABEL, isReportItemFxAccount, reportItemRateLabel,
  previewReportItemOutflow, type ReportItemFxAccount,
} from '../../lib/fxReportItemLedger'
import { fetchFxLots } from '../../hooks/useFxLots'
import type { FxLot } from '../../lib/fxLots'

const FX_OPTIONS: FxCode[] = ['KRW' as FxCode, 'USD', 'EUR', 'JPY', 'GBP', 'CNY']
const DEFAULT_CURRENCY = 'KRW'

// 자동생성 항목 판별
function isAutoItem(item: ReportItem) {
  return item.memo?.startsWith('@auto:') ?? false
}
function autoItemName(item: ReportItem) {
  const raw = item.memo?.replace('@auto:', '') ?? ''
  if (raw.startsWith('bond:')) return `[국채] ${raw.slice(5)}`
  return raw
}

export interface PrefillPayload {
  direction:   'in' | 'out'
  amount:      number
  currency:    string
  accountType: string
  category?:   string
}

interface DraftState {
  category:    string
  amtStr:      string
  currency:    string
  accountType: string
  memo:        string
  /** 외화 항목 적용 환율(원/1외화) — 입력하면 외화거래명세 원장에 항목 그대로 반영된다 */
  rateStr:     string
  /** 외화 원장 계좌유형 — 환율을 입력하면 필수(2026-11-26) */
  fxAcct:      ReportItemFxAccount | ''
}

type LinkedPopup = 'invest_return' | 'loan_drawdown' | 'invest_execute' | 'loan_repayment' | null

interface Props {
  direction:       'in' | 'out'
  company:         Company
  reportDate:      string
  reportId:        string | null
  items:           ReportItem[]
  threads:         Record<string, ThreadEntry[]>
  isReadOnly:      boolean
  authorCode:      string
  authorLabel:     string
  activeAccounts:  string[]          // 현재 활성 계좌 목록 (daily 데이터에서 추출)
  prefill?:        PrefillPayload | null
  onPrefillConsumed?: () => void
  toKRW:           (amount: number, currency: string) => number
  onEnsureReport:  () => Promise<string | null>
  onAdd:    (input: {
    direction: 'in'|'out'; category: string; amount: number; currency: string;
    amount_krw?: number|null; memo?: string|null; account_type?: string|null;
    // 연동 팝업으로 생성된 원천 레코드 역참조 (investment | equity | loan)
    linked_type?: string|null; linked_id?: string|null
    /** 외화 적용 환율 — 원장 항목 단위 반영(2026-11-25) */
    fx_rate?: number|null
    /** 외화 원장 계좌유형(보통예금/MMDA) — 2026-11-26 */
    fx_account_type?: ReportItemFxAccount|null
  }) => Promise<string | null>
  onUpdate:        (id: string, patch: Partial<ReportItem>) => Promise<void>
  onRemove:        (id: string) => Promise<void>
  onFetchThreads:  (itemId: string) => Promise<void>
  onAddThread:     (itemId: string, code: string, label: string, body: string) => Promise<void>
  /**
   * 연동 팝업이 운용자금·차입금·지분 레코드를 새로 만든 뒤 호출.
   * ⚠ 이걸 호출하지 않으면 자금현황 표(useDailyReportSummary)가 stale 상태로 남아
   *   방금 만든 자산이 행으로도, 입출금 귀속으로도 나타나지 않는다.
   */
  onSourceChanged?: () => void
  /** 외화거래명세 원장에 반영된 항목 id — 행 배지 표시용 */
  ledgerReflected?: ReadonlySet<string>
}

function fmtAmt(n: number, isFx = false): string {
  if (n === 0) return ''
  if (isFx) {
    // 외화: 소수점 최대 2자리 표시, trailing zero 제거
    return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  }
  return Math.round(n).toLocaleString('ko-KR')
}
function parseAmt(s: string): number {
  return Number(s.replace(/,/g, '')) || 0
}
function isFxCurrency(currency: string) {
  return currency !== 'KRW'
}
/** 환율 문자열 → 숫자. 비었거나 0 이하이면 null(원장 미반영) */
function parseRate(s: string): number | null {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}
/** 환율 표시 — 100원 미만(JPY 등)은 소수 3자리 */
function fmtRate(r: number): string {
  return r.toLocaleString('ko-KR', { maximumFractionDigits: r < 100 ? 3 : 2 })
}

/** 출금 미리보기 한 줄 — 그 계좌 잔액·FIFO 장부환율·예상 환차손익 (모듈 레벨: 렌더 중 컴포넌트 정의 금지) */
function OutflowPreviewLine({ lots, account, amount, currency, txnDate, rate }: {
  lots: FxLot[] | null; account: ReportItemFxAccount; amount: number; currency: string; txnDate: string; rate: number | null
}) {
  if (!lots) return <p className="mt-1 text-[10px] text-gray-400">원장 잔액 확인 중…</p>
  const label = REPORT_ITEM_FX_ACCOUNT_LABEL[account]
  const pv = previewReportItemOutflow(lots, account, amount, txnDate, rate)
  if (pv.shortfall > 0) {
    return (
      <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
        ⚠ {currency} {label} 원장 잔액 부족 — 가능 {fmtAmt(pv.available, true) || '0'} / 출금 {fmtAmt(amount, true)} (거래일 {txnDate}).
        {' '}은행에서 계좌를 옮겼다면 외화거래명세 › 계좌 대체를 먼저 기록하세요. 이대로 저장하면 원장에는 반영되지 않습니다.
      </p>
    )
  }
  return (
    <p className="mt-1 text-[10px] text-indigo-700 dark:text-indigo-300">
      💱 {label}에서 선입선출 출금 · 장부환율 ≈ <b>{pv.bookRate != null ? fmtRate(pv.bookRate) : '—'}원</b>
      {pv.pnlKRW != null && (
        <> · 예상 환차손익 <b className={pv.pnlKRW < 0 ? 'text-red-600 dark:text-red-400' : ''}>
          {Math.round(pv.pnlKRW).toLocaleString('ko-KR')}원</b></>
      )}
      <span className="text-gray-400"> (가능 {fmtAmt(pv.available, true)} · 미리보기)</span>
    </p>
  )
}

export default function ItemsSection({
  direction, company, reportDate, reportId, items, threads, isReadOnly,
  authorCode, authorLabel, activeAccounts,
  prefill, onPrefillConsumed,
  toKRW,
  onEnsureReport, onAdd, onUpdate, onRemove, onFetchThreads, onAddThread,
  onSourceChanged, ledgerReflected,
}: Props) {
  const { hasCategory } = useAuth()

  // 사용자 카테고리 권한에 따라 표시할 항목 필터링 (null=모두 허용)
  const visibleCategories = direction === 'in'
    ? IN_CATEGORIES.filter(c => hasCategory('in', c.code))
    : OUT_CATEGORIES.filter(c => hasCategory('out', c.code))

  const [draft, setDraft]           = useState<DraftState | null>(null)
  const [threadItem, setThreadItem] = useState<ReportItem | null>(null)
  const [editId, setEditId]         = useState<string | null>(null)
  const [editAmt, setEditAmt]       = useState('')
  const [saving, setSaving]         = useState(false)
  const [linkedPopup, setLinkedPopup] = useState<LinkedPopup>(null)
  const amtRef = useRef<HTMLInputElement>(null)
  const [fxAcctErr, setFxAcctErr] = useState(false)

  // ── 연동 팝업 저장 콜백 ──────────────────────────────────────
  async function handleLinkedSaved(
    amount: number, currency: string, memo: string,
    linkedType?: string, linkedId?: string,
  ) {
    if (!reportId) {
      const newId = await onEnsureReport()
      if (!newId) return
    }
    const catCode = draft?.category ?? (direction === 'in' ? 'invest_return' : 'invest_execute')
    const krw = currency !== 'KRW' ? toKRW(amount, currency) : null
    await onAdd({
      direction,
      category:     catCode,
      amount,
      currency,
      amount_krw:   krw,
      memo:         memo || null,
      // ⭐ 계좌구분이 비면 통화로 추론한다. 비워두면 그 현금이 어느 계좌에서 움직였는지
      //   표시되지 않아, 자금현황에서 `기초 + 입금 − 출금 = 마감` 이 그 행에서
      //   성립하지 않는 것처럼 보인다(2026-09-11 리포트).
      //   사용자가 직접 고른 값이 있으면 그것을 우선한다.
      account_type: draft?.accountType || defaultAccountTypeFor(currency),
      // 팝업이 방금 생성한 원천 레코드(운용자금/지분/차입금) 역참조 —
      // 이 값이 없으면 일보 항목에서 어떤 자산이 만들어졌는지 추적할 수 없다
      linked_type:  linkedType ?? null,
      linked_id:    linkedId ?? null,
    })
    setDraft(null)
    setLinkedPopup(null)
    // 원천 레코드(운용자금·차입금·지분)가 새로 생겼으므로 자금현황을 다시 읽는다
    if (linkedId) onSourceChanged?.()
  }

  function openLinkedPopup() {
    const cat = draft?.category
    if (cat === 'invest_return')  { setLinkedPopup('invest_return');  return }
    if (cat === 'loan_drawdown')  { setLinkedPopup('loan_drawdown');  return }
    if (cat === 'invest_execute') { setLinkedPopup('invest_execute'); return }
    if (cat === 'loan_repayment') { setLinkedPopup('loan_repayment'); return }
  }

  const categories = visibleCategories
  const defaultCat = (categories[0] ?? (direction === 'in' ? IN_CATEGORIES[0] : OUT_CATEGORIES[0])).code
  const myItems    = items.filter(i => i.direction === direction)
  const total      = myItems.reduce((s, i) => s + (i.amount_krw ?? toKRW(i.amount, i.currency)), 0)

  // 항목 추가 행 열릴 때 금액 필드 포커스
  useEffect(() => {
    if (draft !== null) setTimeout(() => amtRef.current?.focus(), 50)
  }, [draft !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Δ 클릭 prefill 처리
  useEffect(() => {
    if (!prefill || prefill.direction !== direction) return
    setDraft({
      category:    prefill.category ?? defaultCat,
      amtStr:      fmtAmt(prefill.amount, isFxCurrency(prefill.currency)),
      currency:    prefill.currency,
      accountType: prefill.accountType,
      memo:        '',
      rateStr:     '',
      fxAcct:      '',
    })
    onPrefillConsumed?.()
  }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 신규 항목 저장 ───────────────────────────────────────
  async function handleAddSave() {
    if (!draft) return
    const amount = parseAmt(draft.amtStr)
    if (amount <= 0) { amtRef.current?.focus(); return }
    // 환율을 넣어 원장에 반영할 외화 항목은 외화계좌가 필수(2026-11-26 Q3)
    const ledgerItem = isLedgerCategory({ currency: draft.currency, category: draft.category })
    if (ledgerItem && parseRate(draft.rateStr) != null && !draft.fxAcct) { setFxAcctErr(true); return }
    setSaving(true)
    if (!reportId) {
      const newId = await onEnsureReport()
      if (!newId) { setSaving(false); return }
    }
    // 환율을 입력했으면 원화 환산도 그 환율로 — 실제 적용 환율과 화면 금액이 같아야 한다
    const rate = isFxCurrency(draft.currency) ? parseRate(draft.rateStr) : null
    const krw = draft.currency !== 'KRW'
      ? (rate != null ? Math.round(amount * rate) : toKRW(amount, draft.currency)) : null
    await onAdd({
      direction,
      category:     draft.category,
      amount,
      currency:     draft.currency,
      amount_krw:   krw,
      memo:         draft.memo || null,
      account_type: draft.accountType || null,
      fx_rate:      rate,
      fx_account_type: ledgerItem && draft.fxAcct ? draft.fxAcct : null,
    })
    setDraft(null)
    setFxAcctErr(false)
    setSaving(false)
  }

  // ── 계좌구분 인라인 수정 ─────────────────────────────────
  // 연동 팝업으로 만든 과거 항목은 account_type 이 비어 있다(2026-09-11 이전).
  // 그 항목은 자금현황의 계좌 행에 잡히지 않아 `기초+입금−출금=마감` 이 어긋나 보인다.
  // 삭제 후 재등록하지 않고 여기서 바로 고칠 수 있게 한다.
  const [acctEditId, setAcctEditId] = useState<string | null>(null)

  // ── 환율·외화계좌 인라인 입력 — 연동 팝업처럼 환율 없이 저장된 외화 항목도 여기서 원장에 반영한다 ──
  //   ⚠ 계좌 선택칸과 환율칸을 오가므로 blur 로 저장하지 않는다(Enter·✓ 로만 저장, Esc·✕ 취소).
  const [rateEditId, setRateEditId] = useState<string | null>(null)
  const [rateEdit, setRateEdit]     = useState('')
  const [acctEdit, setAcctEdit]     = useState<ReportItemFxAccount | ''>('')
  const [rateEditErr, setRateEditErr] = useState<string | null>(null)
  const tip = (t: string) => (isReadOnly ? t.replace(/ 클릭해.*$/, '') : t)
  function startRateEdit(item: ReportItem) {
    setRateEditId(item.id)
    setRateEdit(item.fx_rate != null ? String(item.fx_rate) : '')
    setAcctEdit(isReportItemFxAccount(item.fx_account_type) ? item.fx_account_type : '')
    setRateEditErr(null)
  }
  async function commitRate(item: ReportItem) {
    const rate = parseRate(rateEdit)
    const acct = acctEdit || null
    // 신규 반영은 계좌 필수. 계좌 없이 이미 반영된 기존 항목(Q3 — 기존 방식 유지)은 그대로 둘 수 있다.
    const legacyKeep = !acct && item.fx_account_type == null && (ledgerReflected?.has(item.id) ?? false)
    if (rate != null && !acct && !legacyKeep) { setRateEditErr('외화계좌(보통예금/MMDA)를 선택하세요'); return }
    setRateEditId(null)
    const patch: Partial<ReportItem> = {}
    if ((item.fx_rate ?? null) !== rate) {
      patch.fx_rate = rate
      // 환율을 바꾸면 원화 환산도 그 환율로 — 지우면 현재 시세 환산으로 돌아간다
      patch.amount_krw = rate != null ? Math.round(item.amount * rate) : toKRW(item.amount, item.currency)
    }
    if ((item.fx_account_type ?? null) !== acct) patch.fx_account_type = acct
    if (Object.keys(patch).length === 0) return
    await onUpdate(item.id, patch)
  }

  // ── 출금 미리보기용 원장 로트 — 외화 출금을 입력·수정 중일 때만 그 통화를 읽는다 ──
  const rateEditItem = rateEditId ? items.find(i => i.id === rateEditId) ?? null : null
  const previewCurrency = direction !== 'out' ? null
    : draft && isFxCurrency(draft.currency) ? draft.currency
    : rateEditItem && isFxCurrency(rateEditItem.currency) ? rateEditItem.currency
    : null
  const [previewLots, setPreviewLots] = useState<{ key: string; lots: FxLot[] } | null>(null)
  useEffect(() => {
    if (!previewCurrency) return
    let alive = true
    void fetchFxLots(company, previewCurrency).then(r => {
      if (alive) setPreviewLots({ key: `${company}|${previewCurrency}`, lots: r.lots })
    })
    return () => { alive = false }
    // ledgerReflected — 다른 항목이 반영·해제되면 잔액이 바뀌므로 다시 읽는다
  }, [company, previewCurrency, ledgerReflected])
  const lotsFor = (cur: string) => (previewLots?.key === `${company}|${cur}` ? previewLots.lots : null)

  async function commitAccount(item: ReportItem, value: string) {
    setAcctEditId(null)
    if ((item.account_type ?? '') === value) return
    await onUpdate(item.id, { account_type: value || null })
  }

  // ── 인라인 금액 수정 ─────────────────────────────────────
  function startEdit(item: ReportItem) {
    setEditId(item.id)
    setEditAmt(fmtAmt(item.amount, isFxCurrency(item.currency)) || String(item.amount))
  }
  async function commitEdit(item: ReportItem) {
    const amount = parseAmt(editAmt)
    if (amount > 0 && amount !== item.amount) {
      const amount_krw = item.currency !== 'KRW' ? toKRW(amount, item.currency) : null
      // 자동항목 수정 시: memo에서 @auto: 프리픽스 제거 (수동항목으로 전환)
      const patch: Partial<ReportItem> = { amount, amount_krw }
      if (isAutoItem(item)) patch.memo = autoItemName(item) + ' 평가손익 (수정됨)'
      await onUpdate(item.id, patch)
    }
    setEditId(null)
  }

  const colorHdr = direction === 'in'
    ? 'text-green-700 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
  const colorBtn = direction === 'in'
    ? 'bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
    : 'bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'
  const addBtnCls = direction === 'in'
    ? 'border-green-200 dark:border-green-800 text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
    : 'border-red-200 dark:border-red-800 text-red-500 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'

  function catLabel(code: string) {
    return [...IN_CATEGORIES, ...OUT_CATEGORIES].find(c => c.code === code)?.label ?? code
  }
  function catDef(code: string) {
    return categories.find(c => c.code === code)
  }

  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 flex flex-col">

      {/* 헤더 */}
      <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h2 className={`text-sm font-semibold ${colorHdr}`}>
          {direction === 'in' ? '📥 입금 내역' : '📤 출금 내역'}
        </h2>
        <span className={`text-xs font-bold tabular-nums ${colorHdr}`}>
          합계&nbsp;
          {total > 0 ? (total / 1e8).toFixed(1) + '억' : '—'}
        </span>
      </div>

      {/* 아이템 목록 */}
      <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
        {myItems.length === 0 && !draft && (
          <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-600">
            <p className="text-xl mb-1">{direction === 'in' ? '📥' : '📤'}</p>
            <p>{direction === 'in' ? '입금 항목을 추가하세요' : '출금 항목을 추가하세요'}</p>
            <p className="mt-1 text-[10px]">상단 Δ 셀 클릭 시 자동 입력됩니다</p>
          </div>
        )}

        {myItems.map(item => {
          const def        = catDef(item.category)
          const krwAmt     = item.amount_krw ?? toKRW(item.amount, item.currency)
          const isEditing  = editId === item.id
          const isAuto     = isAutoItem(item)
          const acctLabel  = item.account_type ? ACCOUNT_LABELS[item.account_type] : null

          return (
            <div key={item.id} className={`px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50/50 dark:hover:bg-slate-700/20 group text-xs ${isAuto ? 'bg-purple-50/30 dark:bg-purple-900/10' : ''}`}>

              {/* 🔄 자동생성 배지 */}
              {isAuto && (
                <span title={`자동생성 항목 — ${autoItemName(item)} 평가손익\n금액 클릭으로 수정 가능`}
                  className="shrink-0 text-[10px] text-purple-500 dark:text-purple-400 cursor-help">
                  🔄
                </span>
              )}

              {/* 카테고리 배지 */}
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${colorBtn}`}>
                {catLabel(item.category)}
              </span>

              {/* 계좌구분 — 클릭해서 바로 고친다. 미지정이면 눈에 띄게 표시해
                  "이 항목이 어느 계좌 행에도 안 잡힌다"는 사실을 드러낸다. */}
              {acctEditId === item.id ? (
                <select
                  autoFocus
                  defaultValue={item.account_type ?? ''}
                  onChange={e => void commitAccount(item, e.target.value)}
                  onBlur={() => setAcctEditId(null)}
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-100 focus:outline-none"
                >
                  <option value="">미지정</option>
                  {activeAccounts.map(k => (
                    <option key={k} value={k}>{ACCOUNT_LABELS[k] ?? k}</option>
                  ))}
                </select>
              ) : (
                <button
                  disabled={isReadOnly}
                  onClick={() => setAcctEditId(item.id)}
                  title={isReadOnly ? undefined : '클릭해서 계좌구분 변경'}
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] disabled:cursor-default ${
                    acctLabel
                      ? 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-300 enabled:hover:bg-gray-200 dark:enabled:hover:bg-slate-600'
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-dashed border-amber-300 dark:border-amber-700 enabled:hover:bg-amber-100'
                  }`}
                >
                  {acctLabel ?? '계좌 미지정'}
                </button>
              )}

              {/* 금액 (인라인 편집) */}
              <div className="flex items-baseline gap-1 min-w-0">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editAmt}
                    onChange={e => {
                      const raw = e.target.value.replace(/,/g, '')
                      if (isFxCurrency(item.currency)) {
                        if (raw !== '' && !/^\d*\.?\d{0,2}$/.test(raw)) return
                        const dotIdx = raw.indexOf('.')
                        if (dotIdx === -1) {
                          const n = parseInt(raw, 10)
                          setEditAmt(raw === '' ? '' : n.toLocaleString('ko-KR'))
                        } else {
                          const intStr = raw.slice(0, dotIdx)
                          const n = parseInt(intStr, 10)
                          const intFmt = intStr === '' ? '0' : (isNaN(n) ? '0' : n.toLocaleString('ko-KR'))
                          setEditAmt(intFmt + '.' + raw.slice(dotIdx + 1))
                        }
                      } else {
                        if (raw !== '' && !/^\d*$/.test(raw)) return
                        const n = parseInt(raw, 10)
                        setEditAmt(raw === '' ? '' : n.toLocaleString('ko-KR'))
                      }
                    }}
                    onBlur={() => void commitEdit(item)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void commitEdit(item)
                      if (e.key === 'Escape') setEditId(null)
                    }}
                    className="w-32 text-right text-xs px-2 py-0.5 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 tabular-nums focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => !isReadOnly && startEdit(item)}
                    disabled={isReadOnly}
                    className="tabular-nums font-semibold text-gray-700 dark:text-gray-200 hover:underline disabled:cursor-default"
                    title={isReadOnly ? '' : isAuto ? `🔄 ${autoItemName(item)} 평가손익 — 클릭하여 수정` : '클릭하여 수정'}
                  >
                    {fmtAmt(item.amount, isFxCurrency(item.currency))}
                  </button>
                )}
                <span className="text-gray-400 dark:text-gray-500 text-[10px]">{item.currency}</span>
                {item.currency !== 'KRW' && krwAmt > 0 && (
                  <span className="text-gray-400 dark:text-gray-500 text-[10px]">
                    ({Math.round(krwAmt / 1e4).toLocaleString()}만원)
                  </span>
                )}
                {/* 💱 외화거래명세(원장) 반영 상태 — 클릭해 환율 입력·수정 */}
                {(() => {
                  const st = reportItemLedgerState(item, ledgerReflected ?? new Set())
                  if (st === 'not_applicable') return null
                  if (rateEditId === item.id) {
                    const legacy = item.fx_account_type == null && (ledgerReflected?.has(item.id) ?? false)
                    return (
                      <span className="inline-flex flex-col">
                        <span className="inline-flex items-center gap-1">
                          <select
                            value={acctEdit}
                            onChange={e => { setAcctEdit(e.target.value as ReportItemFxAccount | ''); setRateEditErr(null) }}
                            onKeyDown={e => { if (e.key === 'Escape') setRateEditId(null) }}
                            className={`text-[10px] px-1 py-0.5 rounded border bg-white dark:bg-slate-700 focus:outline-none ${
                              rateEditErr ? 'border-red-400' : 'border-indigo-300 dark:border-indigo-600'}`}
                          >
                            <option value="">{legacy ? '자동(기존 방식)' : '외화계좌'}</option>
                            {REPORT_ITEM_FX_ACCOUNTS.map(a => <option key={a} value={a}>{REPORT_ITEM_FX_ACCOUNT_LABEL[a]}</option>)}
                          </select>
                          <input
                            autoFocus
                            type="text"
                            inputMode="decimal"
                            value={rateEdit}
                            onChange={e => {
                              const raw = e.target.value.replace(/,/g, '')
                              if (raw !== '' && !/^\d*\.?\d{0,4}$/.test(raw)) return
                              setRateEdit(raw)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void commitRate(item)
                              if (e.key === 'Escape') setRateEditId(null)
                            }}
                            placeholder={`${reportItemRateLabel(item.direction)} (현재 ${fmtRate(toKRW(1, item.currency)) || '—'})`}
                            className="w-28 text-right text-[10px] px-1.5 py-0.5 rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 tabular-nums focus:outline-none"
                          />
                          <button type="button" onClick={() => void commitRate(item)} title="저장 (Enter)"
                            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">✓</button>
                          <button type="button" onClick={() => setRateEditId(null)} title="취소 (Esc)"
                            className="text-[10px] px-1 text-gray-400 hover:text-gray-600">✕</button>
                        </span>
                        {rateEditErr && <span className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">{rateEditErr}</span>}
                        {/* 이미 반영된 출금은 자기 소진분이 원장에 빠져 있어 미리보기가 틀린다 — 미반영일 때만 */}
                        {item.direction === 'out' && acctEdit && !(ledgerReflected?.has(item.id) ?? false) && (
                          <OutflowPreviewLine lots={lotsFor(item.currency)} account={acctEdit} amount={item.amount}
                            currency={item.currency} txnDate={reportDate} rate={parseRate(rateEdit)} />
                        )}
                      </span>
                    )
                  }
                  const acctName = isReportItemFxAccount(item.fx_account_type)
                    ? REPORT_ITEM_FX_ACCOUNT_LABEL[item.fx_account_type] : null
                  const badge = st === 'reflected'
                    ? { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700',
                        text: `💱 원장 반영 · ${acctName ?? '자동'} @${fmtRate(item.fx_rate ?? 0)}`,
                        tip: acctName
                          ? `외화거래명세 ${acctName} 계좌에 이 항목 그대로 반영됐습니다. 클릭해 계좌·환율을 고치면 원장도 함께 바뀝니다.`
                          : '외화거래명세에 기존 방식(입금 보통예금 · 출금 우선순위 선입선출)으로 반영됐습니다. 클릭해 계좌를 지정하면 그 계좌로 다시 반영합니다.' }
                    : st === 'missing_rate'
                    ? { cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700',
                        text: `💱 계좌·${reportItemRateLabel(item.direction)} 입력 시 원장 반영`,
                        tip: '외화계좌(보통예금/MMDA)와 환율을 입력하면 외화거래명세에 이 항목 그대로 반영됩니다.' }
                    : { cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700',
                        text: `💱 원장 미반영${acctName ? ` · ${acctName}` : ''} @${fmtRate(item.fx_rate ?? 0)}`,
                        tip: '환율은 있지만 원장 반영에 실패했습니다(선택 계좌 잔액 부족 — 계좌 대체 미기록, 권한, 설정 미적용). 클릭해 다시 저장하면 재시도합니다.' }
                  return (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => startRateEdit(item)}
                      title={tip(badge.tip)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap disabled:cursor-default ${badge.cls}`}
                    >
                      {badge.text}
                    </button>
                  )
                })()}
              </div>

              {/* 메모 (자동항목은 종목명 표시) */}
              {isAuto ? (
                <span className="text-purple-400 dark:text-purple-500 text-[10px] truncate max-w-[100px]">
                  {autoItemName(item)}
                </span>
              ) : item.memo ? (
                <span className="text-gray-400 dark:text-gray-500 truncate max-w-[120px]" title={item.memo}>
                  {item.memo}
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                {/* 💬 스레드 버튼 */}
                {def?.thread && (
                  <button onClick={() => setThreadItem(item)}
                    className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors p-0.5 rounded"
                    title="사유 스레드">
                    💬
                  </button>
                )}

                {/* 🔗 연동 배지 */}
                {def?.linked && (
                  <span
                    className="text-amber-400 dark:text-amber-500 p-0.5"
                    title={`연동 항목 — ${catLabel(item.category)}`}>
                    🔗
                  </span>
                )}

                {/* 삭제 */}
                {!isReadOnly && (
                  <button
                    onClick={() => void onRemove(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-all p-0.5 rounded"
                    title="삭제">
                    ✕
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* 신규 입력 행 */}
        {draft !== null && (() => {
          const isLinked = !!catDef(draft.category)?.linked
          return (
            <div className="px-4 py-3 bg-blue-50/30 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-800/30">
              <div className="flex flex-wrap items-center gap-2">

                {/* 카테고리 */}
                <select
                  value={draft.category}
                  onChange={e => setDraft(d => d ? { ...d, category: e.target.value } : d)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>

                {isLinked ? (
                  /* 연동 카테고리: 팝업 트리거 버튼 */
                  <button
                    onClick={openLinkedPopup}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    🔗 연동 팝업에서 선택
                  </button>
                ) : (
                  <>
                    {/* 계좌구분 */}
                    <select
                      value={draft.accountType}
                      onChange={e => setDraft(d => d ? { ...d, accountType: e.target.value } : d)}
                      className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">계좌구분 (선택)</option>
                      {activeAccounts.map(k => (
                        <option key={k} value={k}>{ACCOUNT_LABELS[k] ?? k}</option>
                      ))}
                    </select>

                    {/* 금액 */}
                    <input
                      ref={amtRef}
                      type="text"
                      inputMode={isFxCurrency(draft.currency) ? 'decimal' : 'numeric'}
                      value={draft.amtStr}
                      onChange={e => {
                        const raw = e.target.value.replace(/,/g, '')
                        if (isFxCurrency(draft.currency)) {
                          // 외화: 소수점 최대 2자리 허용
                          if (raw !== '' && !/^\d*\.?\d{0,2}$/.test(raw)) return
                          const dotIdx = raw.indexOf('.')
                          let formatted: string
                          if (dotIdx === -1) {
                            const n = parseInt(raw, 10)
                            formatted = isNaN(n) ? '' : n.toLocaleString('ko-KR')
                          } else {
                            // 정수부: 천단위 콤마, 소수부: 그대로 보존
                            const intStr = raw.slice(0, dotIdx)
                            const decStr = raw.slice(dotIdx + 1)
                            const n = parseInt(intStr, 10)
                            const intFmt = intStr === '' ? '0' : (isNaN(n) ? '0' : n.toLocaleString('ko-KR'))
                            formatted = intFmt + '.' + decStr
                          }
                          setDraft(d => d ? { ...d, amtStr: raw === '' ? '' : formatted } : d)
                        } else {
                          if (raw !== '' && !/^\d*$/.test(raw)) return
                          const n = parseInt(raw, 10)
                          setDraft(d => d ? { ...d, amtStr: raw === '' ? '' : n.toLocaleString('ko-KR') } : d)
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleAddSave()
                        if (e.key === 'Escape') setDraft(null)
                      }}
                      placeholder="금액 입력"
                      className="w-32 text-xs text-right px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />

                    {/* 통화 */}
                    <select
                      value={draft.currency}
                      onChange={e => {
                        const newCurrency = e.target.value
                        setDraft(d => {
                          if (!d) return d
                          // KRW로 전환 시 소수점 제거해 정수로 재변환
                          const newAmt = !isFxCurrency(newCurrency)
                            ? String(Math.round(parseAmt(d.amtStr)) || '') .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                            : d.amtStr
                          return { ...d, currency: newCurrency, amtStr: newAmt }
                        })
                      }}
                      className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      {FX_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {/* 외화계좌 — 외화이면서 원장 반영 대상일 때만. 환율을 입력하면 필수 */}
                    {isLedgerCategory({ currency: draft.currency, category: draft.category }) && (
                      <select
                        value={draft.fxAcct}
                        onChange={e => { setFxAcctErr(false); setDraft(d => d ? { ...d, fxAcct: e.target.value as ReportItemFxAccount | '' } : d) }}
                        title="외화 원장 계좌 — 입금은 이 계좌로, 출금은 이 계좌의 잔액에서 선입선출로 빠집니다"
                        className={`text-xs px-2 py-1.5 rounded-lg border bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                          fxAcctErr ? 'border-red-400 ring-1 ring-red-300' : 'border-indigo-200 dark:border-indigo-700'}`}
                      >
                        <option value="">외화계좌</option>
                        {REPORT_ITEM_FX_ACCOUNTS.map(a => <option key={a} value={a}>{REPORT_ITEM_FX_ACCOUNT_LABEL[a]}</option>)}
                      </select>
                    )}

                    {/* 환율 — 입금 = 장부환율, 출금 = 적용환율. 입력하면 외화거래명세에 항목 그대로 반영된다 */}
                    {isLedgerCategory({ currency: draft.currency, category: draft.category }) && (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.rateStr}
                        onChange={e => {
                          const raw = e.target.value.replace(/,/g, '')
                          if (raw !== '' && !/^\d*\.?\d{0,4}$/.test(raw)) return
                          setDraft(d => d ? { ...d, rateStr: raw } : d)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleAddSave()
                          if (e.key === 'Escape') setDraft(null)
                        }}
                        placeholder={`${reportItemRateLabel(direction)} (현재 ${fmtRate(toKRW(1, draft.currency)) || '—'})`}
                        title={direction === 'in'
                          ? '장부환율(원/1외화) — 이 입금의 취득환율로 원장에 기록됩니다. 비우면 원장에는 반영되지 않습니다.'
                          : '적용환율(원/1외화, 결제일 환율) — 장부환율은 선택 계좌의 선입선출 로트가 정하고, 차이가 환차손익이 됩니다. 비우면 원장에는 반영되지 않습니다.'}
                        className="w-36 text-xs text-right px-2 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    )}

                    {/* 메모 */}
                    <input
                      type="text"
                      value={draft.memo}
                      onChange={e => setDraft(d => d ? { ...d, memo: e.target.value } : d)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleAddSave()
                        if (e.key === 'Escape') setDraft(null)
                      }}
                      placeholder="메모 (선택)"
                      className="flex-1 min-w-[100px] text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-500 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />

                    {/* 저장/취소 */}
                    <button
                      onClick={() => void handleAddSave()}
                      disabled={saving || !draft.amtStr}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
                    >
                      {saving ? '…' : '저장'}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setDraft(null)}
                  className="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  취소
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-600">
                {isLinked ? '🔗 연동 팝업에서 데이터를 선택하면 자동으로 저장됩니다 · 계좌구분은 통화에 따라 자동 지정됩니다' : 'Enter 저장 · Esc 취소 · 계좌구분은 선택사항'}
                {!isLinked && isLedgerCategory({ currency: draft.currency, category: draft.category }) &&
                  ` · 💱 외화계좌와 ${reportItemRateLabel(direction)}을 입력하면 외화거래명세에 자동 반영됩니다(같은 거래를 다시 입력할 필요 없음)`}
              </p>
              {fxAcctErr && (
                <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">외화계좌(보통예금/MMDA)를 선택하세요 — 원장에 어느 계좌로 반영할지 정해야 합니다.</p>
              )}
              {!isLinked && direction === 'out' && draft.fxAcct && parseAmt(draft.amtStr) > 0 &&
                isLedgerCategory({ currency: draft.currency, category: draft.category }) && (
                <OutflowPreviewLine lots={lotsFor(draft.currency)} account={draft.fxAcct} amount={parseAmt(draft.amtStr)}
                  currency={draft.currency} txnDate={reportDate} rate={parseRate(draft.rateStr)} />
              )}
              {!isLinked && isFxCurrency(draft.currency) && DUPLICATE_RISK_HINT[draft.category] && (
                <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">⚠ {DUPLICATE_RISK_HINT[draft.category]}</p>
              )}
              {!isLinked && isFxCurrency(draft.currency) && NON_LEDGER_CATEGORIES[draft.category] && (
                <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">ℹ {NON_LEDGER_CATEGORIES[draft.category]}</p>
              )}
            </div>
          )
        })()}
      </div>

      {/* 항목 추가 버튼 */}
      {!isReadOnly && !draft && (
        <div className="p-3 border-t border-gray-50 dark:border-slate-700/50">
          <button
            onClick={() => { setFxAcctErr(false); setDraft({ category: defaultCat, amtStr: '', currency: DEFAULT_CURRENCY, accountType: '', memo: '', rateStr: '', fxAcct: '' }) }}
            className={`w-full py-2 border border-dashed rounded-lg text-xs font-medium transition-colors ${addBtnCls}`}
          >
            + {direction === 'in' ? '입금' : '출금'} 항목 추가
          </button>
        </div>
      )}

      {/* 연동 팝업 */}
      {linkedPopup === 'invest_return' && (
        <InvestReturnPopup
          company={company} reportDate={reportDate}
          onSaved={(amt, cur, memo, lt, li) => handleLinkedSaved(amt, cur, memo, lt, li)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'loan_drawdown' && (
        <LoanDrawdownPopup
          company={company}
          onSaved={(amt, cur, memo, lt, li) => handleLinkedSaved(amt, cur, memo, lt, li)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'invest_execute' && (
        <InvestExecutePopup
          company={company} reportDate={reportDate}
          onSaved={(amt, cur, memo, lt, li) => handleLinkedSaved(amt, cur, memo, lt, li)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'loan_repayment' && (
        <LoanRepaymentPopup
          company={company} reportDate={reportDate}
          onSaved={(amt, cur, memo, lt, li) => handleLinkedSaved(amt, cur, memo, lt, li)}
          onClose={() => setLinkedPopup(null)}
        />
      )}

      {/* 스레드 팝업 */}
      {threadItem && (
        <ThreadPopup
          itemId={threadItem.id}
          direction={direction}
          memo={threadItem.memo}
          threads={threads[threadItem.id] ?? []}
          isReadOnly={isReadOnly}
          authorCode={authorCode}
          authorLabel={authorLabel}
          onLoadThreads={onFetchThreads}
          onAddThread={onAddThread}
          onUpdateMemo={(memo) => void onUpdate(threadItem.id, { memo })}
          onClose={() => setThreadItem(null)}
        />
      )}
    </section>
  )
}

