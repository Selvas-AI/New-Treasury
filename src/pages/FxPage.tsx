import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useDaily } from '../hooks/useDaily'
import { useFx } from '../hooks/useFx'
import { useFxTradeHistory } from '../hooks/useFxTradeHistory'
import { useAuth } from '../hooks/useAuth'
import { usePageCompany } from '../hooks/usePageCompany'
import { fmtKRW, fmtNumber, fmtInt } from '../lib/format'
import { NotionTable, type ColumnDef } from '../components/common/NotionTable'
import type { FxCode, FxTradeRecord } from '../types'

const FX_META: Record<FxCode, { name: string; flag: string; unit: string }> = {
  USD: { name: '미국 달러',   flag: '🇺🇸', unit: '1 USD' },
  EUR: { name: '유로',        flag: '🇪🇺', unit: '1 EUR' },
  JPY: { name: '일본 엔',     flag: '🇯🇵', unit: '100 JPY' },
  GBP: { name: '영국 파운드', flag: '🇬🇧', unit: '1 GBP' },
  CNY: { name: '중국 위안',   flag: '🇨🇳', unit: '1 CNY' },
}
const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

type Tab = 'rates' | 'history'

// ── 숫자 천단위 포맷 헬퍼 ────────────────────────────────
// 정수부 콤마, 소수부 그대로 유지 (입력 중 소수점 끝 허용)
function fmtComma(val: string): string {
  if (!val) return ''
  const [int, dec] = val.replace(/,/g, '').split('.')
  const intFmt = (Number(int) || 0).toLocaleString('ko-KR')
  return dec !== undefined ? `${intFmt}.${dec}` : intFmt
}
// 콤마 제거 후 숫자 파싱
function parseComma(val: string): number {
  return Number(val.replace(/,/g, '')) || 0
}

// ── 환전이력 입력 폼 ─────────────────────────────────────
const EMPTY_FORM = {
  trade_date: new Date().toISOString().slice(0, 10),
  currency:   'USD',
  amount_fx:  '',
  acq_rate:   '',
  trade_rate: '',
  memo:       '',
}

function TradeForm({
  company,
  onSaved,
}: {
  company: string | null
  onSaved: () => void
}) {
  const { user, canEdit } = useAuth()
  const hist = useFxTradeHistory(company)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!canEdit()) return null

  const amtFx    = parseComma(form.amount_fx)
  const acqRate  = parseComma(form.acq_rate)
  const saleRate = parseComma(form.trade_rate)
  const krwAmt   = amtFx && saleRate ? Math.round(amtFx * saleRate) : null
  const pnl      = amtFx && acqRate && saleRate
    ? Math.round((saleRate - acqRate) * amtFx)
    : null

  async function handleSave() {
    if (!amtFx || !acqRate || !saleRate || !form.trade_date || !company) return
    setSaving(true)
    setErr(null)
    try {
      await hist.add({
        trade_date: form.trade_date,
        currency:   form.currency,
        amount_fx:  amtFx,
        acq_rate:   acqRate,
        trade_rate: saleRate,
        memo:       form.memo,
        created_by: user?.code ?? '',
      })
      setForm(EMPTY_FORM)
      setOpen(false)
      onSaved()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 환전 이력 추가
        </button>
      ) : (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">신규 환전 이력 입력</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">환전일자</label>
              <input type="date" value={form.trade_date}
                onChange={e => setForm(f => ({ ...f, trade_date: e.target.value }))}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 dark:bg-slate-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">통화</label>
              <select value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 dark:bg-slate-700 dark:text-gray-100">
                {FX_CODES.map(c => <option key={c} value={c}>{c} – {FX_META[c].name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">금액 (외화)</label>
              <input type="text" inputMode="decimal" value={form.amount_fx} placeholder="0.00"
                onChange={e => {
                  const raw = e.target.value.replace(/[^\d.]/g, '')
                  setForm(f => ({ ...f, amount_fx: fmtComma(raw) }))
                }}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right tabular-nums dark:bg-slate-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">장부환율 (가중평균)</label>
              <input type="text" inputMode="decimal" value={form.acq_rate} placeholder="0.00"
                onChange={e => {
                  const raw = e.target.value.replace(/[^\d.]/g, '')
                  setForm(f => ({ ...f, acq_rate: fmtComma(raw) }))
                }}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right tabular-nums dark:bg-slate-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">매각환율</label>
              <input type="text" inputMode="decimal" value={form.trade_rate} placeholder="0.00"
                onChange={e => {
                  const raw = e.target.value.replace(/[^\d.]/g, '')
                  setForm(f => ({ ...f, trade_rate: fmtComma(raw) }))
                }}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right tabular-nums dark:bg-slate-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">원화환산액 (자동)</label>
              <div className="border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800 rounded-lg px-2 py-1.5 text-right text-sm text-blue-700 dark:text-blue-300 font-medium min-h-[34px]">
                {krwAmt != null ? fmtInt(krwAmt) + '원' : '—'}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">환차손익 (자동)</label>
              <div className={`border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-right text-sm font-medium min-h-[34px] ${
                pnl == null ? 'bg-gray-50 dark:bg-slate-800 text-gray-400'
                  : pnl >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
              }`}>
                {pnl != null ? (pnl >= 0 ? '+' : '') + fmtInt(pnl) + '원' : '—'}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">메모</label>
              <input type="text" value={form.memo} placeholder="(선택)"
                onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 dark:bg-slate-700 dark:text-gray-100" />
            </div>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setOpen(false); setErr(null) }}
              className="text-sm px-4 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-gray-200">
              취소
            </button>
            <button onClick={handleSave} disabled={saving || !amtFx || !acqRate || !saleRate}
              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 환전이력 탭 ──────────────────────────────────────────
function TradeHistoryTab({ company }: { company: string | null }) {
  const { canEdit } = useAuth()
  const hist = useFxTradeHistory(company)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const columns: ColumnDef<FxTradeRecord, unknown>[] = [
    { accessorKey: 'trade_date', header: '환전일자', cell: ({ getValue }) => getValue<string>() },
    {
      accessorKey: 'currency', header: '통화',
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'amount_fx', header: '금액(외화)',
      cell: ({ getValue, row }) => `${row.original.currency} ${fmtNumber(getValue<number>(), 2)}`,
    },
    {
      accessorKey: 'acq_rate', header: '장부환율',
      cell: ({ getValue }) => fmtNumber(getValue<number>() ?? 0, 2),
    },
    {
      accessorKey: 'trade_rate', header: '매각환율',
      cell: ({ getValue }) => fmtNumber(getValue<number>() ?? 0, 2),
    },
    {
      accessorKey: 'amount_krw', header: '원화환산액',
      cell: ({ getValue }) => <span className="tabular-nums">{fmtInt(getValue<number>() ?? 0)}</span>,
    },
    {
      accessorKey: 'fx_pnl', header: '환차손익',
      cell: ({ getValue }) => {
        const v = getValue<number>() ?? 0
        return (
          <span className={`tabular-nums font-medium ${v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {v >= 0 ? '+' : ''}{fmtInt(v)}
          </span>
        )
      },
    },
    { accessorKey: 'memo', header: '메모', cell: ({ getValue }) => getValue<string>() || '—' },
    ...(canEdit() ? [{
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }: { row: { original: FxTradeRecord } }) => (
        <button
          onClick={() => setDeleteId(row.original.id)}
          className="text-xs text-red-400 hover:text-red-600 px-2 py-0.5"
        >삭제</button>
      ),
    } as ColumnDef<FxTradeRecord, unknown>] : []),
  ]

  async function handleDelete(id: string) {
    await hist.remove(id)
    setDeleteId(null)
  }

  // 통화별 소계
  const byCurrency = useMemo(() => {
    const m: Record<string, { count: number; pnl: number }> = {}
    hist.data.filter(r => r.status === '완료').forEach(r => {
      if (!m[r.currency]) m[r.currency] = { count: 0, pnl: 0 }
      m[r.currency].count++
      m[r.currency].pnl += r.fx_pnl ?? 0
    })
    return m
  }, [hist.data])

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 p-4 md:col-span-2">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">누적 환차손익</p>
          <p className={`text-2xl font-bold tabular-nums ${hist.totalPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {hist.totalPnl >= 0 ? '+' : ''}{fmtKRW(hist.totalPnl)}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">총 {hist.data.length}건</p>
        </div>
        {Object.entries(byCurrency).map(([cur, s]) => (
          <div key={cur} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 p-4">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
              {(FX_META[cur as FxCode]?.flag ?? '')} {cur} ({s.count}건)
            </p>
            <p className={`text-lg font-bold tabular-nums ${s.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {s.pnl >= 0 ? '+' : ''}{fmtKRW(s.pnl)}
            </p>
          </div>
        ))}
      </div>

      {/* 입력 폼 */}
      <TradeForm company={company} onSaved={() => void hist.load()} />

      {/* 이력 테이블 */}
      {hist.loading ? (
        <p className="text-sm text-gray-400 py-4 text-center">불러오는 중…</p>
      ) : (
        <NotionTable<FxTradeRecord>
          tableId="fx_trade_history"
          columns={columns}
          data={hist.data}
          emptyText="환전 이력이 없습니다."
        />
      )}

      {/* 삭제 확인 모달 */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-xs w-full mx-4 shadow-2xl">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">환전 이력 삭제</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">이 이력을 삭제하시겠습니까? 복구할 수 없습니다.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg py-2 text-sm dark:text-gray-200">
                취소
              </button>
              <button onClick={() => void handleDelete(deleteId)}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm hover:bg-red-700">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────
export default function FxPage() {
  const { currency: paramCurrency } = useParams<{ currency?: string }>()
  const { company } = usePageCompany()
  const daily = useDaily()
  const fx    = useFx()
  const [tab, setTab] = useState<Tab>('rates')

  const [highlight, setHighlight]     = useState<FxCode | null>(null)
  const [calcMode, setCalcMode]       = useState<'krw' | 'fx'>('fx')
  const [calcInput, setCalcInput]     = useState('')
  const [calcCurrency, setCalcCurrency] = useState<FxCode>('USD')

  useEffect(() => {
    const upper = paramCurrency?.toUpperCase() as FxCode
    if (upper && FX_CODES.includes(upper)) {
      setHighlight(upper)
      setCalcCurrency(upper)
    }
  }, [paramCurrency])

  useEffect(() => {
    let cancelled = false
    async function load() { if (!cancelled) await fx.fetchRates() }
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 5 * 60 * 1000)
    function onVisible() { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const latestDaily = useMemo(() => daily.data[0] ?? null, [daily.data])

  const fxBalances: Record<FxCode, number> = {
    USD: latestDaily?.fx_usd ?? 0,
    EUR: latestDaily?.fx_eur ?? 0,
    JPY: latestDaily?.fx_jpy ?? 0,
    GBP: latestDaily?.fx_gbp ?? 0,
    CNY: latestDaily?.fx_cny ?? 0,
  }

  const calcResult = useMemo(() => {
    const v = Number(calcInput) || 0
    if (!v) return null
    if (calcMode === 'fx') return fx.toKRW(v, calcCurrency)
    const rate = fx.rates.find(r => r.code === calcCurrency)
    if (!rate || !rate.rate) return null
    return v / (rate.rate / rate.unit)
  }, [calcInput, calcMode, calcCurrency, fx])

  return (
    <div className="space-y-5 max-w-4xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">환율 / 환전이력</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            FX 정책관리 (Target Band·변동폭 계산) →
            <a href="#/policy"
              onClick={e => { e.preventDefault(); window.location.pathname = window.location.pathname.replace('/fx', '/policy') }}
              className="ml-1 text-blue-500 hover:underline">
              자금정책 관리
            </a>
          </p>
        </div>
        {tab === 'rates' && (
          <button onClick={() => void fx.fetchRates()} disabled={fx.loading}
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
            {fx.loading ? '조회 중...' : '🔄 환율 갱신'}
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {([
          { key: 'rates',   label: '💱 환율 현황' },
          { key: 'history', label: '📋 환전이력' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-sm px-4 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 font-semibold shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 환율 현황 탭 ── */}
      {tab === 'rates' && (
        <>
          {fx.error && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:border-amber-800">
              ⚠️ {fx.error}
            </div>
          )}

          {/* 환율 카드 그리드 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {FX_CODES.map(code => {
              const meta    = FX_META[code]
              const rate    = fx.rates.find(r => r.code === code)
              const balance = fxBalances[code]
              const krwVal  = fx.toKRW(balance, code)
              const isHL    = highlight === code
              return (
                <button key={code} onClick={() => setHighlight(isHL ? null : code)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    isHL
                      ? 'border-blue-400 bg-blue-50 shadow-md dark:bg-blue-950/30 dark:border-blue-500'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:hover:border-blue-500'
                  }`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xl">{meta.flag}</span>
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{code}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{meta.unit}</p>
                  <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
                    {rate ? `₩${fmtNumber(rate.rate)}` : '—'}
                  </p>
                  {balance > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                      <p className="text-xs text-gray-400 dark:text-gray-500">보유잔고</p>
                      <p className="text-xs font-medium text-gray-700 dark:text-slate-100">
                        {fmtNumber(balance, 2)} {code}
                      </p>
                      <p className="text-xs text-blue-600 font-medium">{fmtKRW(krwVal)}</p>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* 외화 잔고 요약 */}
          {latestDaily && (
            <div className="bg-white rounded-xl shadow p-5 dark:bg-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-100">외화 잔고 현황</h3>
                <span className="text-xs text-gray-400 dark:text-gray-500">기준: {latestDaily.date}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700">
                      {['통화', '보유잔고', '환율', '원화환산', '비중'].map(h => (
                        <th key={h} className="text-left text-xs text-gray-400 dark:text-gray-500 font-medium pb-2 pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FX_CODES.filter(c => fxBalances[c] > 0).map(code => {
                      const rate      = fx.rates.find(r => r.code === code)
                      const krwVal    = fx.toKRW(fxBalances[code], code)
                      const totalFxKrw = latestDaily.fx_krw || 1
                      const pct       = totalFxKrw > 0 ? (krwVal / totalFxKrw) * 100 : 0
                      return (
                        <tr key={code} className="border-b border-gray-50 dark:border-slate-700/50 hover:bg-gray-50 dark:hover:bg-slate-700">
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-1.5">
                              <span>{FX_META[code].flag}</span>
                              <span className="font-medium text-gray-800 dark:text-gray-100">{code}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-gray-700 dark:text-gray-200">
                            {fmtNumber(fxBalances[code], 2)}
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-gray-500 dark:text-slate-300">
                            {rate ? `₩${fmtNumber(rate.rate)}` : '—'}
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums font-medium text-blue-700 dark:text-blue-400">
                            {fmtKRW(krwVal)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 min-w-[60px]">
                                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className="text-xs text-gray-500 dark:text-slate-300 w-10 text-right">
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="border-t border-gray-200 dark:border-slate-700">
                      <td colSpan={3} className="pt-2.5 text-xs text-gray-400 dark:text-gray-500 font-medium">합계</td>
                      <td className="pt-2.5 tabular-nums font-bold text-blue-800 dark:text-blue-300">
                        {fmtKRW(latestDaily.fx_krw)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 환산 계산기 */}
          <div className="bg-white rounded-xl shadow p-5 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-100 mb-4">환산 계산기</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-1">
                {[{ key: 'fx', label: '외화 → 원화' }, { key: 'krw', label: '원화 → 외화' }].map(m => (
                  <button key={m.key}
                    onClick={() => { setCalcMode(m.key as 'fx' | 'krw'); setCalcInput('') }}
                    className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                      calcMode === m.key
                        ? 'bg-white text-blue-700 font-semibold shadow-sm dark:bg-gray-600 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-700 dark:text-slate-300'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">통화</label>
                <select value={calcCurrency} onChange={e => setCalcCurrency(e.target.value as FxCode)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                  {FX_CODES.map(c => <option key={c} value={c}>{FX_META[c].flag} {c}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-400 mb-1">
                  {calcMode === 'fx' ? `${calcCurrency} 금액` : '원화 금액 (원)'}
                </label>
                <input type="number" min="0" step="any" value={calcInput}
                  onChange={e => setCalcInput(e.target.value)} placeholder="0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-gray-400 mb-1">
                  {calcMode === 'fx' ? '원화 환산' : `${calcCurrency} 환산`}
                </label>
                <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-semibold text-blue-800 text-right min-h-[38px] dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300">
                  {calcResult !== null
                    ? calcMode === 'fx' ? fmtKRW(calcResult) : `${fmtNumber(calcResult, 4)} ${calcCurrency}`
                    : '—'}
                </div>
              </div>
            </div>
            {fx.rates.length > 0 && (
              <p className="text-xs text-gray-400 mt-3">
                적용 환율: {FX_META[calcCurrency].unit} = ₩{fmtNumber(fx.rates.find(r => r.code === calcCurrency)?.rate ?? 0)}
              </p>
            )}
          </div>
        </>
      )}

      {/* ── 환전이력 탭 ── */}
      {tab === 'history' && (
        <TradeHistoryTab company={company} />
      )}
    </div>
  )
}
