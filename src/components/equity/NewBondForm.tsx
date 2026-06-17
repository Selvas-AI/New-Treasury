import { useState } from 'react'
import { fmtKRW, fmtReturn, returnBadgeClass, calcReturn, calcBondValue, normDate } from '../../lib/format'
import { NumInput } from '../common/NumInput'
import { fetchBondByName, fetchBondPrice } from '../../hooks/useGas'
import type { InvestmentRecord } from '../../types'

interface Props {
  company: string
  onSave: (record: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>
  isEditable: boolean
  existingBonds?: InvestmentRecord[]   // 동일 법인의 전체 국채 이력 — prefill용
}

const EMPTY = {
  bondName: '',
  bondTicker: '',
  priceDate: new Date().toISOString().slice(0, 10),
  bondQty: '',
  bondPrice: '',
  acquisition_cost: '',
  available: '가용' as '가용' | '불가용',
}

export default function NewBondForm({ company, onSave, isEditable, existingBonds }: Props) {
  const [open, setOpen]         = useState(false)
  const [form, setForm]         = useState({ ...EMPTY })
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [candidates, setCandidates] = useState<{ isin: string; name: string }[]>([])
  const [prefillNote, setPrefillNote] = useState<string | null>(null)

  const evalAmt    = calcBondValue(Number(form.bondQty) || 0, Number(form.bondPrice) || 0)
  const retPreview = calcReturn(evalAmt, Number(form.acquisition_cost) || 0)

  function reset() {
    setForm({ ...EMPTY })
    setError(null)
    setCandidates([])
    setPrefillNote(null)
    setOpen(false)
  }

  /** 기존 이력에서 동일 ISIN(bondTicker) 또는 채권명 최신 레코드를 찾아 prefill */
  function prefillFromExisting(isin: string, name: string) {
    if (!existingBonds?.length) return
    const matched = existingBonds.filter(b =>
      (isin && b.bondTicker === isin) || (name && b.bondName === name)
    )
    if (!matched.length) return
    // 최신 priceDate 기준
    const latest = matched.reduce((best, b) =>
      (b.priceDate ?? b.start ?? '') > (best.priceDate ?? best.start ?? '') ? b : best
    )
    const latestDate = latest.priceDate ?? latest.start ?? ''
    setForm(f => ({
      ...f,
      bondQty:          latest.bondQty != null && latest.bondQty > 0 ? String(latest.bondQty) : f.bondQty,
      acquisition_cost: latest.acquisition_cost > 0 ? String(latest.acquisition_cost) : f.acquisition_cost,
      available:        latest.available ?? f.available,
    }))
    setPrefillNote(`"${latest.bondName ?? latest.bank}" 최신 기록(${latestDate})에서 보유좌수·취득가액·가용여부 불러옴`)
  }

  /** 채권명 blur → GAS 이름 검색 → ISIN + 기준가 자동입력 */
  async function handleNameSearch() {
    if (!form.bondName.trim()) return
    setFetching(true)
    setError(null)
    setCandidates([])
    setPrefillNote(null)
    try {
      const res = await fetchBondByName(form.bondName.trim())
      setForm(f => ({
        ...f,
        bondTicker: res.isin,
        bondPrice:  String(res.price),
        priceDate:  normDate(res.date),
      }))
      if (res.candidates.length > 1) {
        setCandidates(res.candidates)
      } else {
        prefillFromExisting(res.isin, res.name || form.bondName.trim())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 조회 실패')
    }
    setFetching(false)
  }

  /** 후보 선택 → 해당 채권으로 기준가 재조회 */
  async function handleCandidatePick(c: { isin: string; name: string }) {
    setCandidates([])
    setFetching(true)
    setError(null)
    setPrefillNote(null)
    try {
      const res = await fetchBondPrice(c.isin)
      setForm(f => ({
        ...f,
        bondName:   c.name,
        bondTicker: c.isin,
        bondPrice:  String(res.price),
        priceDate:  normDate(res.date),
      }))
      prefillFromExisting(c.isin, c.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 기준가 조회 실패')
    }
    setFetching(false)
  }

  /** ISIN blur → 기준가만 재조회 (수동 입력 대비) */
  async function handleIsinSearch() {
    if (!form.bondTicker) return
    setFetching(true)
    setError(null)
    try {
      const res = await fetchBondPrice(form.bondTicker)
      setForm(f => ({ ...f, bondPrice: String(res.price), priceDate: normDate(res.date) }))
      // ISIN 직접 입력 시에도 기존 데이터 prefill 시도
      if (!prefillNote) prefillFromExisting(form.bondTicker, form.bondName)
    } catch (e) {
      setError(e instanceof Error ? e.message : '채권 시세 조회 실패 (T+1 제공)')
    }
    setFetching(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!company || !form.bondName.trim()) { setError('채권명을 입력하세요.'); return }
    setSaving(true)
    setError(null)

    const qty   = Number(form.bondQty)   || 0
    const price = Number(form.bondPrice) || 0
    const acq   = Number(form.acquisition_cost) || 0

    const record = {
      company:          company as InvestmentRecord['company'],
      bank:             form.bondName.trim(),
      product:          '국채' as const,
      currency:         'KRW',
      amount:           calcBondValue(qty, price),
      available:        form.available,
      rate:             0,
      start:            form.priceDate,
      maturity:         '',
      active:           true,
      bondName:         form.bondName.trim(),
      bondTicker:       form.bondTicker.trim() || undefined,
      bondQty:          qty,
      bondPrice:        price,
      priceDate:        form.priceDate,
      acquisition_cost: acq,
    }

    const err = await onSave(record)
    setSaving(false)
    if (err) { setError(err); return }
    reset()
  }

  if (!isEditable) return null

  return (
    <div className="px-4 pt-3 pb-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
          <span className="text-base leading-none">+</span>
          국채/채권 신규 등록
        </button>
      ) : (
        <form onSubmit={handleSave} className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-blue-700">국채/채권 신규 등록</p>
            <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-red-400">취소</button>
          </div>

          {/* 기존 기록 prefill 안내 */}
          {prefillNote && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="text-emerald-600">✓</span>
              <p className="text-xs text-emerald-700">{prefillNote}</p>
              <button
                type="button"
                onClick={() => setPrefillNote(null)}
                className="ml-auto text-emerald-400 hover:text-emerald-600 text-xs">✕</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* 채권명 — 입력 후 blur 시 자동 검색 */}
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">
                채권명 <span className="text-red-400">*</span>
                {fetching && <span className="ml-1 text-blue-400 animate-pulse">시세 조회 중… (최대 30초)</span>}
              </label>
              <input
                type="text"
                value={form.bondName}
                onChange={e => { setForm(f => ({ ...f, bondName: e.target.value })); setCandidates([]); setPrefillNote(null) }}
                onBlur={handleNameSearch}
                placeholder="예: 국고채권 (입력 후 자동 조회)"
                required
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* 후보 드롭다운 */}
              {candidates.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg shadow-lg overflow-hidden">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 px-2 pt-1.5 pb-0.5">검색 결과 — 선택하세요</p>
                  {candidates.map(c => (
                    <button
                      key={c.isin}
                      type="button"
                      onClick={() => void handleCandidatePick(c)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
                    >
                      <span className="font-medium text-gray-800 truncate">{c.name}</span>
                      <span className="text-gray-400 shrink-0 text-[10px]">{c.isin}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCandidates([])}
                    className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 py-1 border-t border-gray-100"
                  >닫기</button>
                </div>
              )}
            </div>

            {/* ISIN — 자동입력, 수동 수정 가능 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">ISIN (자동입력 · 수정가능)</label>
              <input
                type="text"
                value={form.bondTicker}
                onChange={e => setForm(f => ({ ...f, bondTicker: e.target.value }))}
                onBlur={handleIsinSearch}
                placeholder="예: KR103502GCC5"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준일 (자동입력)</label>
              <input
                type="date"
                value={form.priceDate}
                onChange={e => setForm(f => ({ ...f, priceDate: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                보유 좌수
                {prefillNote && Number(form.bondQty) > 0 && (
                  <span className="ml-1 text-emerald-500 text-[10px]">↑ 자동입력</span>
                )}
              </label>
              <NumInput
                value={form.bondQty}
                onChange={raw => setForm(f => ({ ...f, bondQty: raw }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">기준가 (자동입력 · 수정가능)</label>
              <div className="flex gap-1">
                <input
                  type="number" min="0" step="0.01"
                  value={form.bondPrice}
                  onChange={e => setForm(f => ({ ...f, bondPrice: e.target.value }))}
                  placeholder="0"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                {form.bondTicker && (
                  <button
                    type="button" onClick={handleIsinSearch} disabled={fetching}
                    title="기준가 재조회"
                    className="shrink-0 text-xs bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50">
                    {fetching ? '…' : '↺'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                취득가액 (총액)
                {prefillNote && Number(form.acquisition_cost) > 0 && (
                  <span className="ml-1 text-emerald-500 text-[10px]">↑ 자동입력</span>
                )}
              </label>
              <NumInput
                value={form.acquisition_cost}
                onChange={raw => setForm(f => ({ ...f, acquisition_cost: raw }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              가용 여부
              {prefillNote && (
                <span className="ml-1 text-emerald-500 text-[10px]">↑ 자동입력</span>
              )}
            </label>
            <select
              value={form.available}
              onChange={e => setForm(f => ({ ...f, available: e.target.value as '가용' | '불가용' }))}
              className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="가용">가용</option>
              <option value="불가용">불가용</option>
            </select>
          </div>

          {evalAmt > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">평가금액: <strong>{fmtKRW(evalAmt)}</strong></span>
              {retPreview !== null && (
                <span className={`px-1.5 py-0.5 rounded font-medium ${returnBadgeClass(retPreview)}`}>
                  {fmtReturn(retPreview)}
                </span>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit" disabled={saving}
            className="w-full text-xs bg-blue-600 text-white rounded py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? '저장 중...' : '채권 등록'}
          </button>
        </form>
      )}
    </div>
  )
}

