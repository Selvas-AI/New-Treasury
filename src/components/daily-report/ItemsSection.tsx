/**
 * ItemsSection — 입금 또는 출금 라인 아이템 입력 섹션
 *
 * 기능:
 *   - 카테고리 / 계좌구분 / 금액 / 통화 / 메모 입력
 *   - 🔄 자동생성 항목(지분 평가손익) 표시 및 수정
 *   - Δ 셀 클릭 → prefill prop으로 자동 입력 열기
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

import { ACCOUNT_LABELS } from '../../lib/accountLabels'
import { IN_CATEGORIES, OUT_CATEGORIES } from '../../lib/dailyReportCategories'

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
    amount_krw?: number|null; memo?: string|null; account_type?: string|null
  }) => Promise<string | null>
  onUpdate:        (id: string, patch: Partial<ReportItem>) => Promise<void>
  onRemove:        (id: string) => Promise<void>
  onFetchThreads:  (itemId: string) => Promise<void>
  onAddThread:     (itemId: string, code: string, label: string, body: string) => Promise<void>
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

export default function ItemsSection({
  direction, company, reportDate, reportId, items, threads, isReadOnly,
  authorCode, authorLabel, activeAccounts,
  prefill, onPrefillConsumed,
  toKRW,
  onEnsureReport, onAdd, onUpdate, onRemove, onFetchThreads, onAddThread,
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

  // ── 연동 팝업 저장 콜백 ──────────────────────────────────────
  async function handleLinkedSaved(
    amount: number, currency: string, memo: string,
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
      account_type: draft?.accountType || null,
    })
    setDraft(null)
    setLinkedPopup(null)
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
    })
    onPrefillConsumed?.()
  }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 신규 항목 저장 ───────────────────────────────────────
  async function handleAddSave() {
    if (!draft) return
    const amount = parseAmt(draft.amtStr)
    if (amount <= 0) { amtRef.current?.focus(); return }
    setSaving(true)
    if (!reportId) {
      const newId = await onEnsureReport()
      if (!newId) { setSaving(false); return }
    }
    const krw = draft.currency !== 'KRW' ? toKRW(amount, draft.currency) : null
    await onAdd({
      direction,
      category:     draft.category,
      amount,
      currency:     draft.currency,
      amount_krw:   krw,
      memo:         draft.memo || null,
      account_type: draft.accountType || null,
    })
    setDraft(null)
    setSaving(false)
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

              {/* 계좌구분 배지 */}
              {acctLabel && (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-300">
                  {acctLabel}
                </span>
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
                {isLinked ? '🔗 연동 팝업에서 데이터를 선택하면 자동으로 저장됩니다' : 'Enter 저장 · Esc 취소 · 계좌구분은 선택사항'}
              </p>
            </div>
          )
        })()}
      </div>

      {/* 항목 추가 버튼 */}
      {!isReadOnly && !draft && (
        <div className="p-3 border-t border-gray-50 dark:border-slate-700/50">
          <button
            onClick={() => setDraft({ category: defaultCat, amtStr: '', currency: DEFAULT_CURRENCY, accountType: '', memo: '' })}
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
          onSaved={(amt, cur, memo) => handleLinkedSaved(amt, cur, memo)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'loan_drawdown' && (
        <LoanDrawdownPopup
          company={company}
          onSaved={(amt, cur, memo) => handleLinkedSaved(amt, cur, memo)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'invest_execute' && (
        <InvestExecutePopup
          company={company}
          onSaved={(amt, cur, memo) => handleLinkedSaved(amt, cur, memo)}
          onClose={() => setLinkedPopup(null)}
        />
      )}
      {linkedPopup === 'loan_repayment' && (
        <LoanRepaymentPopup
          company={company}
          onSaved={(amt, cur, memo) => handleLinkedSaved(amt, cur, memo)}
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

