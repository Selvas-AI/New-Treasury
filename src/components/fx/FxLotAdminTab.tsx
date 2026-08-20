import { useRef, useState } from 'react'
import { INVENTORY_CSV_TEMPLATE, SALES_CSV_TEMPLATE, parseInventoryCsv, parseSalesCsv, type InventoryCsvRow, type SalesCsvRow } from '../../lib/fxCsvImport'
import { ACCOUNT_TYPE_LABEL, type FxAccountType, type FxLot } from '../../lib/fxLots'
import type { LotRepairPlanItem } from '../../hooks/useFxLots'
import { fmtKRW } from '../../lib/format'
import FxTransferCard from './FxTransferCard'
import FxTermDepositCard from './FxTermDepositCard'
import type { FxLotTransfer } from '../../hooks/useFxTransfers'
import { OUTFLOW_TXN_LABEL, SELECTABLE_OUTFLOW_TXN } from '../../lib/fxTxnType'
import type { Company, FxCode, FxTradeRecord, InvestmentRecord } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const ACCOUNT_TYPE_OPTIONS: { value: FxAccountType; label: string }[] = [
  { value: 'demand_deposit', label: ACCOUNT_TYPE_LABEL.demand_deposit },
  { value: 'mmda',           label: ACCOUNT_TYPE_LABEL.mmda },
  { value: 'term_deposit',   label: ACCOUNT_TYPE_LABEL.term_deposit },
]

interface LedgerAdminApi {
  importOpeningLots: (rows: InventoryCsvRow[], userCode: string) => Promise<{ inserted: number; skipped: number; error: string | null }>
  planLotRepair: (rows?: InventoryCsvRow[]) => Promise<{ plan: LotRepairPlanItem[]; unmatched: number; missingRate: number; error: string | null }>
  applyLotRepair: (plan: LotRepairPlanItem[]) => Promise<{ updated: number; failures: string[] }>
  addOpeningLot: (input: { date: string; amount: number; acqRate: number; accountType: FxAccountType; annualInterestRate: number; maturityDate: string | null; memo: string; userCode: string }) => Promise<string | null>
  addManualOutflow: (input: { date: string; amount: number; rate: number; memo: string; userCode: string; txnType?: 'sale' | 'payment'; accountType?: FxAccountType | null }) => Promise<string | null>
  lots: FxLot[]
  transferLots: (input: {
    date: string; fromAccountType: FxAccountType; toAccountType: FxAccountType
    amount: number; maturityDate: string | null; annualInterestRate: number
    transferRate: number | null; allowEarly: boolean; memo: string; userCode: string
  }) => Promise<string | null>
  settleTermDeposit: (input: {
    date: string; principal: number; toAccountType: FxAccountType
    interest: number; interestRate: number | null
    maturityDate: string | null; annualInterestRate: number
    transferRate: number | null; allowEarly: boolean
    investmentId: string | null; memo: string; userCode: string
  }) => Promise<string | null>
  linkLotsToInvestment: (lotIds: string[], investmentId: string, userCode: string) => Promise<string | null>
  reverseTransfer: (transferId: string, userCode: string) => Promise<string | null>
}

interface TradeAdminApi {
  data: FxTradeRecord[]
  importCompletedSales: (rows: SalesCsvRow[], company: Company, userCode: string) => Promise<{ inserted: number; skipped: number; error: string | null }>
  updateCompletedSale: (id: string, values: { tradeDate: string; amountFx: number; acqRate: number; saleRate: number; memo: string }) => Promise<string | null>
  remove: (id: string) => Promise<void>
}

/**
 * ③ 로트 설정 탭 — 개시 로트 등록, 재고/매각 CSV 임포트, 계좌유형 교정, 그리고
 * 개시 이전(2026년) CSV 로 이관한 과거 매각 실적의 수정/삭제.
 *
 * 이 탭의 항목들은 매일 쓰는 화면이 아니라 원장을 처음 세팅하거나 데이터를 바로잡을 때만
 * 쓰는 관리 도구라 ① 원장 탭에서 분리했다(세션26차 4일차 통폐합).
 */
export function FxLotAdminTab({ ledger, trades, company, currency, valuationMethod, termInvestments, transfers, userCode, canEdit, canDelete, onChanged }: {
  ledger: LedgerAdminApi
  trades: TradeAdminApi
  company: Company
  currency: FxCode
  /** 계좌 대체 평가 방식 (법인 정책) */
  valuationMethod: 'carryover' | 'revalue'
  /** 이 법인·통화의 활성 외화 정기예금(운용자금) — 원장과의 정합성 점검·연결용 */
  termInvestments: InvestmentRecord[]
  /** 계좌 대체 이력 — 원장 표에서 취득일 승계 때문에 눈에 안 띄므로 이벤트 단위로도 보여준다 */
  transfers: FxLotTransfer[]
  userCode: string
  canEdit: boolean
  canDelete: boolean
  onChanged: () => void
}) {
  const [showOpening, setShowOpening] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(0)
  const [rate, setRate] = useState(0)
  const [accountType, setAccountType] = useState<FxAccountType>('demand_deposit')
  const [annualInterestRate, setAnnualInterestRate] = useState(0)
  const [maturityDate, setMaturityDate] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [showOutflow, setShowOutflow] = useState(false)
  const [outDate, setOutDate] = useState(new Date().toISOString().slice(0, 10))
  const [outAmount, setOutAmount] = useState(0)
  const [outRate, setOutRate] = useState(0)
  const [outMemo, setOutMemo] = useState('')
  // 거래 유형 — 매각(환전)과 대외 지급을 구분해야 환차손익 요약의 "매각 실적"이 정확해진다.
  const [outTxnType, setOutTxnType] = useState<'sale' | 'payment'>('payment')
  // 출금 계좌 — 회사 규칙상 외화결제대금(물대)은 보통예금에서만 나간다.
  // 'auto' = 정책 우선순위(fx_fifo_account_priority)를 따름.
  const [outAccount, setOutAccount] = useState<'auto' | FxAccountType>('demand_deposit')
  const [outSaving, setOutSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [inventoryPreview, setInventoryPreview] = useState<{ rows: InventoryCsvRow[]; errors: string[]; skipped: number } | null>(null)
  const [salesPreview, setSalesPreview] = useState<{ rows: SalesCsvRow[]; errors: string[]; skipped: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [repairPlan, setRepairPlan] = useState<{ plan: LotRepairPlanItem[]; unmatched: number; missingRate: number; fromCsv: boolean } | null>(null)
  const [editingTrade, setEditingTrade] = useState<FxTradeRecord | null>(null)
  const [pendingDeleteTrade, setPendingDeleteTrade] = useState<FxTradeRecord | null>(null)

  async function readCsv(file: File, kind: 'inventory' | 'sales') {
    const text = await file.text()
    if (kind === 'inventory') setInventoryPreview(parseInventoryCsv(text))
    else setSalesPreview(parseSalesCsv(text))
    setMessage(null)
  }

  async function importInventory() {
    if (!inventoryPreview || inventoryPreview.errors.length) return
    setImporting(true)
    const r = await ledger.importOpeningLots(inventoryPreview.rows, userCode)
    setImporting(false); setMessage(r.error ?? `${r.inserted}건 등록 · 중복 ${r.skipped}건 건너뜀`)
    if (!r.error) { setInventoryPreview(null); onChanged() }
  }

  async function previewRepair() {
    const csvRows = inventoryPreview && !inventoryPreview.errors.length ? inventoryPreview.rows : undefined
    setImporting(true); setMessage(null); setRepairPlan(null)
    const { plan, unmatched, missingRate, error } = await ledger.planLotRepair(csvRows)
    setImporting(false)
    if (error) { setMessage(`교정 계획 조회 실패: ${error}`); return }
    setRepairPlan({ plan, unmatched, missingRate, fromCsv: !!csvRows })
    if (!plan.length) setMessage('교정할 항목이 없습니다. 계좌유형·이자율·만기가 모두 정상입니다.')
  }

  async function applyRepair() {
    if (!repairPlan?.plan.length) return
    setImporting(true); setMessage(null)
    const r = await ledger.applyLotRepair(repairPlan.plan)
    setImporting(false); setRepairPlan(null)
    setMessage(r.failures.length
      ? `${r.updated}건 교정 · 실패 ${r.failures.length}건: ${r.failures[0]}`
      : `${r.updated}건 교정 완료 — 환전 가능액과 만기 잠금이 갱신되었습니다.`)
    if (r.updated) onChanged()
  }

  async function importSales() {
    if (!salesPreview || salesPreview.errors.length) return
    setImporting(true)
    const r = await trades.importCompletedSales(salesPreview.rows, company, userCode)
    setImporting(false); setMessage(r.error ?? `${r.inserted}건 등록 · 중복 ${r.skipped}건 건너뜀`)
    if (!r.error) { setSalesPreview(null); onChanged() }
  }

  async function saveOpening() {
    if (!(amount > 0) || !(rate > 0)) { setMessage('외화 금액과 장부에 적용한 환율을 입력하세요.'); return }
    if (accountType === 'term_deposit' && (!maturityDate || maturityDate < date)) { setMessage('정기예금은 취득일 이후의 만기일을 입력하세요.'); return }
    setSaving(true)
    const err = await ledger.addOpeningLot({ date, amount, acqRate: rate, accountType,
      annualInterestRate, maturityDate: accountType === 'term_deposit' ? maturityDate : null,
      memo, userCode })
    setSaving(false)
    if (err) setMessage(err.includes('does not exist') || err.includes('schema cache')
      ? '외화거래명세 테이블이 아직 없습니다. docs/db/fx_lot_ledger.sql을 먼저 적용하세요.' : err)
    else { setMessage('외화 유입이 등록되었습니다.'); setShowOpening(false); setAmount(0); setRate(0); setMemo(''); onChanged() }
  }

  async function saveOutflow() {
    if (!(outAmount > 0) || !(outRate > 0)) { setMessage('외화 금액과 처분(체결) 환율을 입력하세요.'); return }
    setOutSaving(true)
    const err = await ledger.addManualOutflow({ date: outDate, amount: outAmount, rate: outRate,
      memo: outMemo, userCode, txnType: outTxnType,
      accountType: outAccount === 'auto' ? null : outAccount })
    setOutSaving(false)
    if (err) setMessage(err)
    else { setMessage('외화 유출이 등록되었습니다 — FIFO 순서대로 로트에서 차감됐습니다.'); setShowOutflow(false); setOutAmount(0); setOutRate(0); setOutMemo(''); onChanged() }
  }

  async function saveTradeEdit() {
    if (!editingTrade) return
    const saleRate = editingTrade.completed_rate ?? editingTrade.trade_rate ?? 0
    const err = await trades.updateCompletedSale(editingTrade.id, {
      tradeDate: editingTrade.trade_date, amountFx: editingTrade.amount_fx,
      acqRate: editingTrade.acq_rate ?? 0, saleRate, memo: editingTrade.memo ?? '',
    })
    setMessage(err ?? '매각 실적을 수정했습니다.')
    if (!err) { setEditingTrade(null); onChanged() }
  }

  async function removeTrade() {
    if (!pendingDeleteTrade) return
    try { await trades.remove(pendingDeleteTrade.id); setMessage('매각 실적을 삭제했습니다.'); setPendingDeleteTrade(null); onChanged() }
    catch (e) { setMessage(e instanceof Error ? e.message : '삭제 실패') }
  }

  const legacySales = trades.data.filter(r => r.memo?.includes('CSV 이관'))

  return (
    <div className="space-y-4">
      {message && (
        <div className="text-xs font-medium text-blue-700 dark:text-blue-300">{message}</div>
      )}
      {canEdit && <div className={CARD}>
        <div className="mb-1 text-sm font-semibold">개시 데이터 가져오기</div>
        <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">파일을 선택하면 먼저 검증 결과만 표시합니다. 실제 저장은 아래 확정 버튼을 다시 눌러야 실행됩니다.</div>
        <div className="grid gap-3 md:grid-cols-2">
          <ImportBox title="현재 외화 재고 CSV" acceptName="fx-inventory_tmp.csv" onFile={f => void readCsv(f, 'inventory')}
            template={INVENTORY_CSV_TEMPLATE} templateName="fx-inventory-template.csv"
            preview={inventoryPreview && `${inventoryPreview.rows.length}개 유효 로트 · 0원 ${inventoryPreview.skipped}건 제외 · 오류 ${inventoryPreview.errors.length}건`}
            errors={inventoryPreview?.errors} onImport={inventoryPreview ? () => void importInventory() : undefined}
            buttonLabel="검토한 개시 로트 등록" disabled={importing || !!inventoryPreview?.errors.length} />
          <ImportBox title="2026년 외화 매각 CSV" acceptName="fx-sales_2026.csv" onFile={f => void readCsv(f, 'sales')}
            template={SALES_CSV_TEMPLATE} templateName="fx-sales-template.csv"
            preview={salesPreview && `${salesPreview.rows.length}건 · 실현손익 ${fmtKRW(salesPreview.rows.reduce((s, r) => s + r.realizedPnlKRW, 0))} · 오류 ${salesPreview.errors.length}건`}
            errors={salesPreview?.errors} onImport={salesPreview ? () => void importSales() : undefined}
            buttonLabel="검토한 과거 매각 등록" disabled={importing || !!salesPreview?.errors.length} />
        </div>
        {/* 계좌유형 교정 — CSV 선택과 무관하게 항상 노출한다(2026-08-12: CSV 선택 시에만
            보이게 했더니 사용자가 버튼을 찾지 못했다). */}
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            🔧 이미 등록된 로트의 계좌유형 교정
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            초기 이관이 계좌유형 컬럼 도입 전에 이뤄져 <strong>정기예금·MMDA가 전부 보통예금으로</strong> 기록된
            경우가 있습니다. 그러면 <strong>만기 전 정기예금이 &lsquo;즉시 환전 가능&rsquo;으로 집계</strong>되어
            환전 권고액이 부풀려집니다.
            <div className="mt-1">
              메모에 원본이 남아 있어 <strong>CSV 없이도 계좌유형·만기는 교정</strong>됩니다.
              연이율까지 채우려면 위에서 재고 CSV를 먼저 선택하세요.
              {inventoryPreview && !inventoryPreview.errors.length
                ? <strong className="ml-1 text-emerald-700 dark:text-emerald-400">CSV 선택됨 — 연이율까지 반영됩니다.</strong>
                : <span className="ml-1 opacity-80">(현재 CSV 미선택 — 연이율은 기존 값 유지)</span>}
            </div>
            <div className="mt-1">금액·환율은 변경하지 않습니다. 아래 미리보기의 실행 버튼을 눌러야 반영됩니다.</div>
          </div>
          <button onClick={() => void previewRepair()} disabled={importing}
            className="mt-2 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {importing ? '확인 중…' : '교정 대상 확인'}
          </button>

          {repairPlan && repairPlan.plan.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-400 bg-white p-3 dark:border-amber-600 dark:bg-slate-900">
              <div className="text-xs font-bold text-gray-900 dark:text-slate-100">
                교정 대상 {repairPlan.plan.length}건 — 아래 내용으로 바꿉니다
              </div>
              <div className="mt-1 text-[11px] text-gray-600 dark:text-slate-300">
                {repairPlan.fromCsv
                  ? 'CSV 기준 · 연이율까지 반영됩니다.'
                  : '메모 기준 · 연이율은 기존 값을 유지합니다. CSV를 선택해 다시 확인하면 연이율도 채워집니다.'}
                {repairPlan.unmatched > 0 && ` · CSV에만 있고 원장에 없는 ${repairPlan.unmatched}건은 건드리지 않습니다.`}
              </div>
              <div className="mt-2 max-h-56 overflow-auto">
                <table className="w-full min-w-[520px] text-[11px]">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-1">취득일</th><th className="py-1">통화</th>
                      <th className="py-1 text-right">금액</th>
                      <th className="py-1">현재</th><th className="py-1">교정 후</th><th className="py-1">만기</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {repairPlan.plan.map(p => (
                      <tr key={p.lotId} className="border-b border-gray-100 dark:border-slate-800">
                        <td className="py-1">{p.date}</td>
                        <td className="py-1">{p.currency}</td>
                        <td className="py-1 text-right">{p.amount.toLocaleString()}</td>
                        <td className="py-1 text-gray-500 dark:text-slate-400">{ACCOUNT_TYPE_LABEL[p.from.accountType]}</td>
                        <td className={`py-1 font-semibold ${p.to.accountType === 'term_deposit' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {ACCOUNT_TYPE_LABEL[p.to.accountType]}
                        </td>
                        <td className="py-1">{p.to.maturityDate ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => void applyRepair()} disabled={importing}
                  className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {importing ? '교정 중…' : `이 ${repairPlan.plan.length}건 교정 실행`}
                </button>
                <button onClick={() => setRepairPlan(null)} disabled={importing}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:text-slate-200">
                  취소
                </button>
                <span className="text-[11px] text-gray-500 dark:text-slate-400">금액·환율은 변경하지 않습니다.</span>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* 계좌 간 대체 — 유입/유출과 달리 총 외화 잔액이 변하지 않는 내부 이동.
          유출·유입으로 따로 등록하면 잔액이 잠깐 어긋나고 손익도 두 번 잡히므로
          반드시 이 카드(서버 단일 트랜잭션)를 쓴다. */}
      <FxTransferCard
        lots={ledger.lots} currency={currency} valuationMethod={valuationMethod}
        canEdit={canEdit} userCode={userCode}
        transfers={transfers} onTransfer={ledger.transferLots}
        onReverse={ledger.reverseTransfer} onChanged={onChanged}
      />

      {/* 정기예금 라이프사이클 — 해지 시 원금은 대체(원가승계), 이자는 해지일 환율의 신규 로트.
          운용자금(investments) 과의 잔액 정합성도 여기서 확인한다. */}
      <FxTermDepositCard
        lots={ledger.lots} currency={currency} investments={termInvestments}
        canEdit={canEdit} userCode={userCode}
        onSettle={ledger.settleTermDeposit} onLink={ledger.linkLotsToInvestment}
        onChanged={onChanged}
      />

      {canEdit && <div className="grid gap-4 md:grid-cols-2">
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <div className="mb-2 text-sm font-semibold">🟢 외화 유입 등록</div>
            <button onClick={() => setShowOpening(v => !v)} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              {showOpening ? '닫기' : '입력'}
            </button>
          </div>
          {!showOpening && (
            <div className="text-xs text-gray-500 dark:text-slate-400">
              언제 외화가 얼마 들어왔고, 장부에 적용한 환율이 얼마인지 기록합니다.
            </div>
          )}
          {showOpening && <>
            <div className="mb-3 text-xs text-amber-700 dark:text-amber-400">회계팀이 확인한 유입액과 장부에 적용한 환율을 입력하세요. 저장은 이 버튼을 누를 때만 실행됩니다.</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">유입일<input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
              <label className="text-xs">외화 금액<input type="number" min={0} value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
              <label className="text-xs">장부에 적용한 환율<input type="number" min={0} value={rate || ''} onChange={e => setRate(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
              <label className="text-xs">계좌 유형<select value={accountType} onChange={e => setAccountType(e.target.value as FxAccountType)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">{ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              {accountType !== 'demand_deposit' && <label className="text-xs">연이율 (%)<input type="number" min={0} step="0.01" value={annualInterestRate || ''} onChange={e => setAnnualInterestRate(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>}
              {accountType === 'term_deposit' && <label className="text-xs">만기일<input type="date" min={date} value={maturityDate} onChange={e => setMaturityDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>}
              <label className="text-xs">메모<input value={memo} onChange={e => setMemo(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
            </div>
            <button disabled={saving} onClick={() => void saveOpening()} className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? '저장 중…' : '확인 후 저장'}</button>
          </>}
        </div>

        <div className={CARD}>
          <div className="flex items-center justify-between">
            <div className="mb-2 text-sm font-semibold">🔴 외화 유출 등록</div>
            <button onClick={() => setShowOutflow(v => !v)} className="rounded bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">
              {showOutflow ? '닫기' : '입력'}
            </button>
          </div>
          {!showOutflow && (
            <div className="text-xs text-gray-500 dark:text-slate-400">
              매각 지시 워크플로우를 거치지 않은 외화 지급(수수료·해외송금 등)을 기록합니다.
              FIFO 순서대로 로트에서 자동 차감됩니다.
            </div>
          )}
          {showOutflow && <>
            <div className="mb-3 text-xs text-amber-700 dark:text-amber-400">실제 처분일과 적용 환율을 입력하세요. 저장은 이 버튼을 누를 때만 실행됩니다.</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">처분일<input type="date" value={outDate} onChange={e => setOutDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
              <label className="text-xs">외화 금액<input type="number" min={0} value={outAmount || ''} onChange={e => setOutAmount(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
              <label className="text-xs">처분(체결) 환율<input type="number" min={0} value={outRate || ''} onChange={e => setOutRate(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
              <label className="text-xs">거래 유형
                <select value={outTxnType} onChange={e => setOutTxnType(e.target.value as 'sale' | 'payment')}
                  className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">
                  {SELECTABLE_OUTFLOW_TXN.map(t => <option key={t} value={t}>{OUTFLOW_TXN_LABEL[t]}</option>)}
                </select>
              </label>
              <label className="text-xs">출금 계좌
                <select value={outAccount} onChange={e => setOutAccount(e.target.value as 'auto' | FxAccountType)}
                  className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">
                  {ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  <option value="auto">자동 (정책 우선순위)</option>
                </select>
              </label>
              <label className="text-xs sm:col-span-2">메모<input value={outMemo} onChange={e => setOutMemo(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
            </div>
            <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
              <strong>대외 지급</strong>(매입대금·수수료 등)은 환차손익이 나더라도 <strong>매각 실적에 잡히지 않습니다.</strong>
              원화로 환전한 것이라면 <strong>매각(환전)</strong>을 고르세요.
              <br />
              <strong>출금 계좌</strong>는 은행에서 실제로 돈이 빠진 계좌입니다 — 회사 규칙상
              외화결제대금(물대)은 보통예금에서 나갑니다. 지정한 계좌 <strong>안에서만</strong> 취득일 순(FIFO)으로
              소진되며, 잔액이 부족하면 저장이 거부됩니다.
            </p>
            <button disabled={outSaving} onClick={() => void saveOutflow()} className="mt-3 rounded bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{outSaving ? '저장 중…' : '확인 후 저장'}</button>
          </>}
        </div>
      </div>}

      {legacySales.length > 0 && <div className={CARD}>
        <div className="mb-1 text-sm font-semibold">개시 이전 과거 매각 실적 (CSV 이관)</div>
        <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">FIFO 로트를 소진하지 않은 순수 과거 실적입니다. 원장 타임라인에는 표시되지 않으며, 여기서만 수정·삭제할 수 있습니다.</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-xs"><thead><tr className="border-b text-left text-gray-500 dark:border-slate-700 dark:text-slate-400"><th className="py-2">매각일</th><th>통화</th><th className="text-right">수량</th><th className="text-right">적용 원가</th><th className="text-right">매각환율</th><th className="text-right">실현손익</th><th className="text-right">관리</th></tr></thead>
        <tbody>{legacySales.map(row => (
          <tr key={row.id} className="border-b border-gray-100 dark:border-slate-800">
            <td className="py-2">{row.trade_date}</td><td>{row.currency}</td>
            <td className="text-right tabular-nums">{row.amount_fx.toLocaleString()}</td>
            <td className="text-right tabular-nums">{row.acq_rate?.toLocaleString() ?? '—'}</td>
            <td className="text-right tabular-nums">{(row.completed_rate ?? row.trade_rate)?.toLocaleString() ?? '—'}</td>
            <td className={`text-right tabular-nums ${(row.completed_pnl ?? row.fx_pnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKRW(row.completed_pnl ?? row.fx_pnl ?? 0)}</td>
            <td className="text-right whitespace-nowrap">
              {canEdit && <button onClick={() => setEditingTrade(row)} className="text-blue-600 hover:underline">수정</button>}
              {canDelete && <button onClick={() => setPendingDeleteTrade(row)} className="ml-2 text-red-600 hover:underline">삭제</button>}
            </td>
          </tr>
        ))}</tbody></table></div>
      </div>}

      {editingTrade && <div className={CARD}><div className="mb-2 text-sm font-semibold">과거 매각 실적 수정</div><div className="grid gap-3 sm:grid-cols-5">
        <label className="text-xs">매각일<input type="date" value={editingTrade.trade_date} onChange={e => setEditingTrade({ ...editingTrade, trade_date: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
        <label className="text-xs">수량<input type="number" value={editingTrade.amount_fx} onChange={e => setEditingTrade({ ...editingTrade, amount_fx: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
        <label className="text-xs">적용 원가<input type="number" value={editingTrade.acq_rate ?? ''} onChange={e => setEditingTrade({ ...editingTrade, acq_rate: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
        <label className="text-xs">매각환율<input type="number" value={editingTrade.completed_rate ?? editingTrade.trade_rate ?? ''} onChange={e => setEditingTrade({ ...editingTrade, completed_rate: Number(e.target.value) })} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
        <label className="text-xs">메모<input value={editingTrade.memo ?? ''} onChange={e => setEditingTrade({ ...editingTrade, memo: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label></div>
        <div className="mt-3 flex gap-2"><button onClick={() => void saveTradeEdit()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">수정 저장</button><button onClick={() => setEditingTrade(null)} className="rounded border px-3 py-1.5 text-xs">취소</button></div></div>}

      {pendingDeleteTrade && <div className="rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm dark:border-red-700 dark:bg-red-900/20">
        <div className="text-sm font-bold text-red-800 dark:text-red-200">삭제 전 확인</div>
        <div className="mt-1 text-xs text-red-700 dark:text-red-300">{pendingDeleteTrade.trade_date} {pendingDeleteTrade.amount_fx.toLocaleString()} {pendingDeleteTrade.currency} 과거 매각 실적을 삭제합니다.</div>
        <div className="mt-3 flex gap-2"><button onClick={() => void removeTrade()} className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">삭제 실행</button><button onClick={() => setPendingDeleteTrade(null)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs dark:bg-slate-800">취소</button></div>
      </div>}
    </div>
  )
}

function ImportBox({ title, acceptName, onFile, preview, errors, onImport, buttonLabel, disabled, template, templateName }: {
  title: string; acceptName: string; onFile: (file: File) => void; preview: string | null
  errors?: string[]; onImport?: () => void; buttonLabel: string; disabled: boolean; template: string; templateName: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('선택된 파일 없음')
  return <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
    <div className="text-xs font-semibold">{title}</div>
    <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label={acceptName} onChange={e => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); onFile(f) } }} className="hidden" />
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => fileRef.current?.click()} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">CSV 파일 선택</button>
      <button type="button" onClick={() => downloadCsv(template, templateName)} className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">표준 양식 다운로드</button>
      <span className="text-xs text-gray-500">{fileName}</span>
    </div>
    {preview && <div className="mt-2 text-xs text-gray-600 dark:text-slate-300">{preview}</div>}
    {!!errors?.length && <div className="mt-1 text-[11px] text-red-600">{errors.slice(0, 3).join(' · ')}</div>}
    {onImport && <button disabled={disabled} onClick={onImport} className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{buttonLabel}</button>}
  </div>
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fileName; a.click()
  URL.revokeObjectURL(url)
}
