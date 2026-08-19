import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { useFxLots, type LotRepairPlanItem } from '../hooks/useFxLots'
import { useFx } from '../hooks/useFx'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { fmtKRW } from '../lib/format'
import type { FxCode, FxTradeRecord } from '../types'
import { ACCOUNT_TYPE_LABEL, type FxAccountType, type FxLot } from '../lib/fxLots'

/** 계좌 유형 드롭다운 — 라벨은 fxLots 의 SSOT 를 그대로 쓴다 */
const ACCOUNT_TYPE_OPTIONS: { value: FxAccountType; label: string }[] = [
  { value: 'demand_deposit', label: ACCOUNT_TYPE_LABEL.demand_deposit },
  { value: 'mmda',           label: ACCOUNT_TYPE_LABEL.mmda },
  { value: 'term_deposit',   label: ACCOUNT_TYPE_LABEL.term_deposit },
]
import { INVENTORY_CSV_TEMPLATE, SALES_CSV_TEMPLATE, parseInventoryCsv, parseSalesCsv, type InventoryCsvRow, type SalesCsvRow } from '../lib/fxCsvImport'

const CURRENCIES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

export default function FxLedgerPage() {
  const { company } = usePageCompany('/fx-ledger')
  const { user, canEdit, canDelete } = useAuth()
  const [currency, setCurrency] = useState<FxCode>('USD')
  const ledger = useFxLots(company, currency)
  const fx = useFx()
  const trades = useFxTradeHistory(company)
  const [tab, setTab] = useState<'lots'|'history'|'pnl'>('lots')
  const marketRate = fx.rates.find(row => row.code === currency)?.rate ?? 0
  const [showOpening, setShowOpening] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(0)
  const [rate, setRate] = useState(0)
  const [accountType, setAccountType] = useState<FxAccountType>('demand_deposit')
  const [annualInterestRate, setAnnualInterestRate] = useState(0)
  const [maturityDate, setMaturityDate] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [inventoryPreview, setInventoryPreview] = useState<{ rows: InventoryCsvRow[]; errors: string[]; skipped: number } | null>(null)
  const [salesPreview, setSalesPreview] = useState<{ rows: SalesCsvRow[]; errors: string[]; skipped: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [editingLot, setEditingLot] = useState<FxLot | null>(null)
  // 교정 미리보기 — 조회 결과만 담는다. 저장은 실행 버튼을 눌러야 일어난다.
  const [repairPlan, setRepairPlan] = useState<{
    plan: LotRepairPlanItem[]; unmatched: number; missingRate: number; fromCsv: boolean
  } | null>(null)
  const [editingTrade, setEditingTrade] = useState<FxTradeRecord | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'lot'; row: FxLot } | { kind: 'trade'; row: FxTradeRecord } | null>(null)

  async function readCsv(file: File, kind: 'inventory'|'sales') {
    const text = await file.text()
    if (kind === 'inventory') setInventoryPreview(parseInventoryCsv(text))
    else setSalesPreview(parseSalesCsv(text))
    setMessage(null)
  }

  async function importInventory() {
    if (!inventoryPreview || inventoryPreview.errors.length) return
    setImporting(true)
    const r = await ledger.importOpeningLots(inventoryPreview.rows, user?.code ?? 'unknown')
    setImporting(false); setMessage(r.error ?? `${r.inserted}건 등록 · 중복 ${r.skipped}건 건너뜀`)
    if (!r.error) setInventoryPreview(null)
  }

  /**
   * 계좌유형 교정 — 이미 등록된 로트의 account_type/이자율/만기를 CSV 기준으로 되돌린다.
   *
   * 초기 이관이 account_type 컬럼 도입 전에 이뤄져 값이 memo 에만 남고 컬럼은 기본값이었다.
   * 그 탓에 만기 전 정기예금이 "즉시 환전 가능"으로 집계됐다.
   * 계획을 먼저 보여 주고, 사용자가 확인 대화상자를 승인해야만 반영한다.
   */
  /**
   * 교정 대상 조회 — **아무것도 저장하지 않는다.** 결과를 화면 패널에 띄운다.
   *
   * ⚠ window.confirm 을 쓰지 않는다. 크롬은 같은 페이지에서 대화상자가 반복되면
   *   "추가 대화상자 표시 안 함"으로 차단하고, 그때 confirm() 은 **즉시 false 를 반환**한다.
   *   그러면 버튼만 깜빡이고 아무 반응이 없는 것처럼 보인다(2026-08-12 사용자 리포트).
   *   데이터를 바꾸는 조작은 화면 안 패널로 검토·승인받는다.
   */
  async function previewRepair() {
    const csvRows = inventoryPreview && !inventoryPreview.errors.length ? inventoryPreview.rows : undefined
    setImporting(true); setMessage(null); setRepairPlan(null)
    const { plan, unmatched, missingRate, error } = await ledger.planLotRepair(csvRows)
    setImporting(false)
    if (error) { setMessage(`교정 계획 조회 실패: ${error}`); return }
    setRepairPlan({ plan, unmatched, missingRate, fromCsv: !!csvRows })
    if (!plan.length) setMessage('교정할 항목이 없습니다. 계좌유형·이자율·만기가 모두 정상입니다.')
  }

  /** 실제 반영 — 사용자가 패널의 실행 버튼을 눌렀을 때만 호출된다 */
  async function applyRepair() {
    if (!repairPlan?.plan.length) return
    setImporting(true); setMessage(null)
    const r = await ledger.applyLotRepair(repairPlan.plan)
    setImporting(false); setRepairPlan(null)
    setMessage(r.failures.length
      ? `${r.updated}건 교정 · 실패 ${r.failures.length}건: ${r.failures[0]}`
      : `${r.updated}건 교정 완료 — 환전 가능액과 만기 잠금이 갱신되었습니다.`)
  }

  async function importSales() {
    if (!salesPreview || salesPreview.errors.length) return
    setImporting(true)
    const r = await trades.importCompletedSales(salesPreview.rows, company, user?.code ?? 'unknown')
    setImporting(false); setMessage(r.error ?? `${r.inserted}건 등록 · 중복 ${r.skipped}건 건너뜀`)
    if (!r.error) setSalesPreview(null)
  }

  // '부분체결'도 이미 확정된 체결분(completed_pnl)을 갖고 있어 함께 표시한다.
  // (세션26차 3일차 — 부분체결 중간 상태 거래가 이 탭에 안 보이던 결함 수정)
  const completed = trades.data.filter(row => row.status === '완료' || row.status === '부분체결')
  const pnlSummary = useMemo(() => {
    const values = completed.map(row => row.completed_pnl ?? row.fx_pnl ?? 0)
    return { gain: values.filter(v => v > 0).reduce((a, b) => a + b, 0),
      loss: values.filter(v => v < 0).reduce((a, b) => a + b, 0),
      net: values.reduce((a, b) => a + b, 0) }
  }, [completed])

  async function saveOpening() {
    if (!(amount > 0) || !(rate > 0)) { setMessage('외화 금액과 개시 장부환율을 입력하세요.'); return }
    if (accountType === 'term_deposit' && (!maturityDate || maturityDate < date)) { setMessage('정기예금은 취득일 이후의 만기일을 입력하세요.'); return }
    setSaving(true)
    const err = await ledger.addOpeningLot({ date, amount, acqRate: rate, accountType,
      annualInterestRate, maturityDate: accountType === 'term_deposit' ? maturityDate : null,
      memo, userCode: user?.code ?? 'unknown' })
    setSaving(false)
    if (err) setMessage(err.includes('does not exist') || err.includes('schema cache')
      ? '외화 원장 테이블이 아직 없습니다. docs/db/fx_lot_ledger.sql을 먼저 적용하세요.' : err)
    else { setMessage('개시 로트가 등록되었습니다.'); setShowOpening(false); setAmount(0); setRate(0); setMemo('') }
  }

  async function saveLotEdit() {
    if (!editingLot) return
    const err=await ledger.updateLot(editingLot.id,{acquiredDate:editingLot.acquiredDate,
      amount:editingLot.originalAmount,acqRate:editingLot.acqRate,accountType:editingLot.accountType,
      annualInterestRate:editingLot.annualInterestRate,maturityDate:editingLot.maturityDate ?? null,memo:editingLot.memo ?? ''})
    setMessage(err ?? '로트를 수정했습니다.'); if(!err)setEditingLot(null)
  }

  async function removeLot(lot: FxLot) {
    const err=await ledger.deleteLot(lot.id); setMessage(err ?? '로트를 삭제했습니다.')
    if (!err) setPendingDelete(null)
  }

  async function saveTradeEdit() {
    if (!editingTrade) return
    const saleRate = editingTrade.completed_rate ?? editingTrade.trade_rate ?? 0
    const err = await trades.updateCompletedSale(editingTrade.id, {
      tradeDate: editingTrade.trade_date, amountFx: editingTrade.amount_fx,
      acqRate: editingTrade.acq_rate ?? 0, saleRate, memo: editingTrade.memo ?? '',
    })
    setMessage(err ?? '매각 실적을 수정했습니다.'); if (!err) setEditingTrade(null)
  }

  async function removeTrade(row: FxTradeRecord) {
    try { await trades.remove(row.id); setMessage('매각 실적을 삭제했습니다.'); setPendingDelete(null) }
    catch (e) { setMessage(e instanceof Error ? e.message : '삭제 실패') }
  }

  return <div className="space-y-4 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">외화 FIFO 원장</h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">{company} · 오래 들어온 외화부터 소진되는 실제 장부 원가를 관리합니다.</p></div>
      {canEdit() && <button onClick={() => setShowOpening(v => !v)} className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">개시 로트 등록</button>}
    </div>
    <div className="flex gap-2">{CURRENCIES.map(code => <button key={code} onClick={() => setCurrency(code)}
      className={`rounded px-3 py-1.5 text-xs font-semibold ${currency === code ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}`}>{code}</button>)}</div>

    {canEdit() && <div className={CARD}>
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
      {/* 계좌유형 교정 — CSV 선택과 무관하게 **항상** 노출한다.
          (CSV 를 골라야만 보이게 했더니 사용자가 버튼을 찾지 못했다 — 2026-08-12) */}
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

        {/* 미리보기 패널 — 여기서 검토하고 실행 버튼을 눌러야 저장된다 */}
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
              <span className="text-[11px] text-gray-500 dark:text-slate-400">
                금액·환율은 변경하지 않습니다.
              </span>
            </div>
          </div>
        )}
      </div>
      {message && <div className="mt-3 text-xs font-medium text-blue-700 dark:text-blue-300">{message}</div>}
    </div>}

    {showOpening && <div className={CARD}>
      <div className="mb-2 text-sm font-semibold">기존 외화를 하나의 개시 로트로 등록</div>
      <div className="mb-3 text-xs text-amber-700 dark:text-amber-400">회계팀이 확인한 잔액과 장부환율을 입력하세요. 저장은 이 버튼을 누를 때만 실행됩니다.</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs">개시일<input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
        <label className="text-xs">외화 금액<input type="number" min={0} value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
        <label className="text-xs">장부환율<input type="number" min={0} value={rate || ''} onChange={e => setRate(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
        {/* 계좌 유형에 따라 필요한 입력란만 노출한다.
            보통예금: 없음 / MMDA: 이자율 / 정기예금: 이자율 + 만기일(환전 잠금) */}
        <label className="text-xs">계좌 유형<select value={accountType} onChange={e=>setAccountType(e.target.value as FxAccountType)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">{ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        {accountType !== 'demand_deposit' && <label className="text-xs">연이율 (%)<input type="number" min={0} step="0.01" value={annualInterestRate || ''} onChange={e=>setAnnualInterestRate(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>}
        {accountType === 'term_deposit' && <label className="text-xs">만기일<input type="date" min={date} value={maturityDate} onChange={e=>setMaturityDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>}
        <label className="text-xs">메모<input value={memo} onChange={e => setMemo(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
      </div>
      <button disabled={saving} onClick={() => void saveOpening()} className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? '저장 중…' : '확인 후 저장'}</button>
      {message && <div className="mt-2 text-xs text-gray-600 dark:text-slate-300">{message}</div>}
    </div>}
    {editingLot && <div className={CARD}><div className="mb-2 text-sm font-semibold">개시 로트 수정</div><div className="grid gap-3 sm:grid-cols-4">
      <label className="text-xs">취득일<input type="date" value={editingLot.acquiredDate} onChange={e=>setEditingLot({...editingLot,acquiredDate:e.target.value})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
      <label className="text-xs">외화 금액<input type="number" min={0} value={editingLot.originalAmount} onChange={e=>setEditingLot({...editingLot,originalAmount:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
      <label className="text-xs">장부환율<input type="number" min={0} value={editingLot.acqRate} onChange={e=>setEditingLot({...editingLot,acqRate:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
      <label className="text-xs">계좌 유형<select value={editingLot.accountType} onChange={e=>setEditingLot({...editingLot,accountType:e.target.value as FxAccountType,maturityDate:e.target.value==='term_deposit'?editingLot.maturityDate:null})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800">{ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      {editingLot.accountType !== 'demand_deposit' && <label className="text-xs">연이율 (%)<input type="number" min={0} step="0.01" value={editingLot.annualInterestRate} onChange={e=>setEditingLot({...editingLot,annualInterestRate:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>}
      {editingLot.accountType === 'term_deposit' && <label className="text-xs">만기일<input type="date" min={editingLot.acquiredDate} value={editingLot.maturityDate ?? ''} onChange={e=>setEditingLot({...editingLot,maturityDate:e.target.value})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>}
      <label className="text-xs">메모<input value={editingLot.memo ?? ''} onChange={e=>setEditingLot({...editingLot,memo:e.target.value})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label></div>
      <div className="mt-3 flex gap-2"><button onClick={()=>void saveLotEdit()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">수정 저장</button><button onClick={()=>setEditingLot(null)} className="rounded border px-3 py-1.5 text-xs">취소</button></div></div>}
    {editingTrade && <div className={CARD}><div className="mb-2 text-sm font-semibold">과거 매각 실적 수정</div><div className="grid gap-3 sm:grid-cols-5">
      <label className="text-xs">매각일<input type="date" value={editingTrade.trade_date} onChange={e=>setEditingTrade({...editingTrade,trade_date:e.target.value})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label>
      <label className="text-xs">수량<input type="number" value={editingTrade.amount_fx} onChange={e=>setEditingTrade({...editingTrade,amount_fx:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
      <label className="text-xs">적용 원가<input type="number" value={editingTrade.acq_rate ?? ''} onChange={e=>setEditingTrade({...editingTrade,acq_rate:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
      <label className="text-xs">매각환율<input type="number" value={editingTrade.completed_rate ?? editingTrade.trade_rate ?? ''} onChange={e=>setEditingTrade({...editingTrade,completed_rate:Number(e.target.value)})} className="mt-1 w-full rounded border px-2 py-1.5 text-right dark:bg-slate-800" /></label>
      <label className="text-xs">메모<input value={editingTrade.memo ?? ''} onChange={e=>setEditingTrade({...editingTrade,memo:e.target.value})} className="mt-1 w-full rounded border px-2 py-1.5 dark:bg-slate-800" /></label></div>
      <div className="mt-3 flex gap-2"><button onClick={()=>void saveTradeEdit()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">수정 저장</button><button onClick={()=>setEditingTrade(null)} className="rounded border px-3 py-1.5 text-xs">취소</button></div></div>}
    {pendingDelete && <div className="rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm dark:border-red-700 dark:bg-red-900/20"><div className="text-sm font-bold text-red-800 dark:text-red-200">삭제 전 확인</div><div className="mt-1 text-xs text-red-700 dark:text-red-300">{pendingDelete.kind==='lot'?`${pendingDelete.row.acquiredDate} ${pendingDelete.row.remainingAmount.toLocaleString()} ${pendingDelete.row.currency} 로트를 삭제합니다. 소진 이력이 있으면 서버가 거부합니다.`:`${pendingDelete.row.trade_date} ${pendingDelete.row.amount_fx.toLocaleString()} ${pendingDelete.row.currency} 과거 매각 실적을 삭제합니다.`}</div><div className="mt-3 flex gap-2"><button onClick={()=>pendingDelete.kind==='lot'?void removeLot(pendingDelete.row):void removeTrade(pendingDelete.row)} className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">삭제 실행</button><button onClick={()=>setPendingDelete(null)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs dark:bg-slate-800">취소</button></div></div>}

    {ledger.error && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{ledger.error.includes('does not exist') || ledger.error.includes('schema cache') ? '원장 스키마 적용 전입니다. docs/db/fx_lot_ledger.sql을 Supabase SQL Editor에서 검토·실행하세요.' : ledger.error}</div>}
    <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="잔여 외화" value={ledger.totalAmount.toLocaleString()} />
      <Stat label="현재 환전 가능" value={ledger.availableAmount.toLocaleString()} />
      <Stat label="만기 전 잠금" value={ledger.lockedAmount.toLocaleString()} />
      <Stat label="예상 만기이자" value={ledger.expectedInterestFx.toLocaleString(undefined,{maximumFractionDigits:2})} />
      <Stat label="FIFO 잔존 장부환율" value={ledger.bookRate ? `${ledger.bookRate.toFixed(1)}원` : '—'} />
      <Stat label="현재 시장환율" value={marketRate ? `${marketRate.toFixed(1)}원` : '조회 전'} />
      <Stat label="미실현 평가손익" value={ledger.bookRate && marketRate ? fmtKRW(ledger.totalAmount * (marketRate - ledger.bookRate)) : '—'} />
    </div>
    <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
      {([['lots','보유 로트'],['history','매각 이력'],['pnl','환차손익 요약']] as const).map(([key,label]) =>
        <button key={key} onClick={() => setTab(key)} className={`border-b-2 px-3 py-2 text-sm ${tab === key ? 'border-blue-600 font-semibold text-blue-600' : 'border-transparent text-gray-500'}`}>{label}</button>)}
    </div>

    {tab === 'lots' && <div className={CARD}><div className="mb-2 text-sm font-semibold">보유 로트</div>
      {ledger.loading ? <div className="text-xs text-gray-500">조회 중…</div> : ledger.lots.length === 0 ? <div className="text-xs text-gray-500">등록된 로트가 없습니다.</div> :
      <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-xs"><thead><tr className="border-b text-left text-gray-500"><th className="py-2">취득일</th><th>계좌 유형</th><th>만기일</th><th className="text-right">연이율</th><th className="text-right">최초 금액</th><th className="text-right">잔여 금액</th><th className="text-right">취득환율</th><th>상태</th><th>메모</th><th className="text-right">관리</th></tr></thead>
      <tbody>{ledger.lots.map(lot => { const locked=lot.accountType==='term_deposit'&&!!lot.maturityDate&&lot.maturityDate>new Date().toISOString().slice(0,10); return <tr key={lot.id} className="border-b border-gray-100 dark:border-slate-800"><td className="py-2">{lot.acquiredDate}</td><td>{ACCOUNT_TYPE_LABEL[lot.accountType]}</td><td>{lot.maturityDate ?? '—'}</td><td className="text-right">{lot.accountType!=='demand_deposit'?`${lot.annualInterestRate.toFixed(2)}%`:'—'}</td><td className="text-right">{lot.originalAmount.toLocaleString()}</td><td className="text-right font-semibold">{lot.remainingAmount.toLocaleString()}</td><td className="text-right">{lot.acqRate.toLocaleString()}</td><td><span className={`rounded px-1.5 py-0.5 ${locked?'bg-amber-100 text-amber-800':'bg-emerald-100 text-emerald-800'}`}>{locked?'만기 전 잠금':'환전 가능'}</span></td><td>{lot.memo ?? '—'}</td><td className="text-right whitespace-nowrap">{canEdit()&&<button onClick={()=>setEditingLot(lot)} className="text-blue-600 hover:underline">수정</button>}{canDelete()&&<button onClick={()=>setPendingDelete({kind:'lot',row:lot})} className="ml-2 text-red-600 hover:underline">삭제</button>}</td></tr>})}</tbody></table></div>}
    </div>}
    {tab === 'history' && <div className={CARD}><div className="mb-2 text-sm font-semibold">완료된 외화 매각</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-xs"><thead><tr className="border-b text-left text-gray-500"><th className="py-2">매각일</th><th>통화</th><th className="text-right">체결 수량</th><th className="text-right">지시 수량</th><th className="text-right">적용 원가</th><th className="text-right">매각환율</th><th className="text-right">실현손익</th><th>상태</th><th>구분</th><th className="text-right">관리</th></tr></thead>
      <tbody>{completed.map(row => <tr key={row.id} className="border-b border-gray-100 dark:border-slate-800"><td className="py-2">{row.trade_date}</td><td>{row.currency}</td><td className="text-right">{(row.status === '부분체결' ? row.filled_amount : row.amount_fx).toLocaleString()}</td><td className="text-right text-gray-400">{row.status === '부분체결' ? row.amount_fx.toLocaleString() : '—'}</td><td className="text-right">{row.acq_rate?.toLocaleString() ?? '—'}</td><td className="text-right">{(row.completed_rate ?? row.trade_rate)?.toLocaleString() ?? '—'}</td><td className={`text-right ${(row.completed_pnl ?? row.fx_pnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKRW(row.completed_pnl ?? row.fx_pnl ?? 0)}</td><td>{row.status === '부분체결' ? <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">부분체결</span> : '완료'}</td><td>{row.memo?.includes('CSV 이관') ? '개시 전 실적' : '원장 연동'}</td><td className="text-right whitespace-nowrap">{canEdit() && row.memo?.includes('CSV 이관') && <button onClick={()=>setEditingTrade(row)} className="text-blue-600 hover:underline">수정</button>}{canDelete() && row.memo?.includes('CSV 이관') && <button onClick={()=>setPendingDelete({kind:'trade',row})} className="ml-2 text-red-600 hover:underline">삭제</button>}</td></tr>)}</tbody></table></div>
    </div>}
    {tab === 'pnl' && <>
      <div className="grid gap-3 sm:grid-cols-4"><Stat label="누적 실현이익" value={fmtKRW(pnlSummary.gain)} /><Stat label="누적 실현손실" value={fmtKRW(pnlSummary.loss)} /><Stat label="순 실현손익" value={fmtKRW(pnlSummary.net)} /><Stat label={`${currency} 미실현손익`} value={ledger.bookRate && marketRate ? fmtKRW(ledger.totalAmount * (marketRate - ledger.bookRate)) : '—'} /></div>
      <div className={CARD}><div className="text-sm font-semibold">읽는 법</div><div className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-slate-300">개시 이전 매각은 확정 실적만 복원하며 현재 로트를 다시 차감하지 않습니다. 개시 이후 거래부터 FIFO 소진 명세와 연결됩니다. 수수료가 없는 CSV 이력은 수수료 차감 전 손익입니다.</div></div>
    </>}
  </div>
}

function Stat({ label, value }: { label: string; value: string }) { return <div className={CARD}><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-lg font-bold text-gray-900 dark:text-slate-100">{value}</div></div> }

function ImportBox({ title, acceptName, onFile, preview, errors, onImport, buttonLabel, disabled, template, templateName }: {
  title: string; acceptName: string; onFile: (file: File) => void; preview: string | null
  errors?: string[]; onImport?: () => void; buttonLabel: string; disabled: boolean; template: string; templateName: string
}) { const fileRef=useRef<HTMLInputElement>(null); const [fileName,setFileName]=useState('선택된 파일 없음'); return <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700"><div className="text-xs font-semibold">{title}</div>
  <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label={acceptName} onChange={e => { const f=e.target.files?.[0]; if(f){setFileName(f.name);onFile(f)} }} className="hidden" />
  <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => fileRef.current?.click()} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">CSV 파일 선택</button><button type="button" onClick={()=>downloadCsv(template,templateName)} className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">표준 양식 다운로드</button><span className="text-xs text-gray-500">{fileName}</span></div>
  {preview && <div className="mt-2 text-xs text-gray-600 dark:text-slate-300">{preview}</div>}
  {!!errors?.length && <div className="mt-1 text-[11px] text-red-600">{errors.slice(0,3).join(' · ')}</div>}
  {onImport && <button disabled={disabled} onClick={onImport} className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{buttonLabel}</button>}
  </div> }

function downloadCsv(content:string,fileName:string){const blob=new Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;a.click();URL.revokeObjectURL(url)}
