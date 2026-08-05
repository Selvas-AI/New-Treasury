/**
 * InvestExecutePopup — 투자 집행 연동 팝업
 *
 * 투자 집행(출금)을 실제 자산 레코드로 등록하고 일보 항목에 연동한다.
 * 투자 성격에 따라 저장 테이블/메뉴가 다르므로 먼저 "자산 구분"을 선택한다:
 *
 *   운용자금        → investments (정기예금/MMF/RP/CP/전자단기사채/기타)  · 운용자금 메뉴
 *   국채·채권       → investments (product='국채' + bond_* 필드)          · 지분/장기투자 > 채권 탭
 *   상장주식        → equities    (market=KOSPI|KOSDAQ)                   · 지분/장기투자 > 지분 탭
 *   비상장주식      → equities    (market=비상장) — RCPS 등              · 지분/장기투자 > 비상장 탭
 *
 * ⚠ investments 의 실제 DB 컬럼은 start_date 다(start 아님).
 *   반드시 investToDb() 매핑을 거쳐 insert 한다.
 */
import { useState } from 'react'
import { restInsert } from '../../lib/supabase'
import { investToDb } from '../../hooks/useInvestments'
import { generateUUID, calcBondValue } from '../../lib/format'
import { todayStr } from '../../lib/bizDay'
import type { Company } from '../../types'

interface Props {
  company:    Company
  /** 일보 보고 기준일 — 지분 레코드의 기준일(date) 기본값 */
  reportDate?: string
  onSaved:    (
    amount: number, currency: string, memo: string,
    linkedType: string, linkedId: string,
  ) => Promise<void>
  onClose:    () => void
}

// ── 자산 구분 ────────────────────────────────────────────────────────────
type Dest = 'invest' | 'bond' | 'listed' | 'unlisted'

const DESTS: { key: Dest; label: string; hint: string }[] = [
  { key: 'invest',   label: '운용자금',   hint: '정기예금·MMF·RP 등 · 운용자금 메뉴' },
  { key: 'bond',     label: '국채·채권',  hint: '지분/장기투자 > 채권 탭' },
  { key: 'listed',   label: '상장주식',   hint: '지분/장기투자 > 지분 탭' },
  { key: 'unlisted', label: '비상장주식', hint: 'RCPS·CB 등 · 지분/장기투자 > 비상장 탭' },
]

const PRODUCTS  = ['정기예금', 'MMF', 'RP', 'CP', '전자단기사채', '기타']
const PURPOSES  = ['단순투자', '경영참여', '전략적제휴', '기타']

/** 자산 구분별 가용여부 기본값 — 비상장·상장은 즉시 현금화가 어렵거나 매각제한이 흔함 */
const DEFAULT_AVAILABLE: Record<Dest, '가용' | '불가용'> = {
  invest: '가용', bond: '가용', listed: '가용', unlisted: '불가용',
}

function parseNum(s: string): number {
  return Number(String(s).replace(/,/g, '')) || 0
}
function fmtComma(n: number): string {
  return n > 0 ? n.toLocaleString('ko-KR') : ''
}

// ── 스타일/입력 헬퍼 (모듈 레벨 — 렌더 안에서 정의하면 매 입력마다 재마운트되어 포커스가 풀린다) ──
const inputCls = 'text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full'
const roCls    = inputCls + ' bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
const labelCls = 'text-xs text-gray-500 dark:text-slate-300 w-20 shrink-0'

function Row({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className={labelCls}>{label} {req && <span className="text-red-400">*</span>}</span>
      {children}
    </div>
  )
}

/** 천단위 콤마 숫자 입력 */
function NumInput({ value, onChange, placeholder }: {
  value: string; onChange: (s: string) => void; placeholder: string
}) {
  return (
    <input type="text" inputMode="numeric" value={value} placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value.replace(/[^\d]/g, '')
        onChange(raw === '' ? '' : parseInt(raw, 10).toLocaleString('ko-KR'))
      }}
      className={inputCls + ' text-right tabular-nums'} />
  )
}

export default function InvestExecutePopup({ company, reportDate, onSaved, onClose }: Props) {
  const today = todayStr()
  const [dest, setDest] = useState<Dest>('invest')

  // 공통
  const [amtStr,    setAmtStr]    = useState('')
  const [amtTouched, setAmtTouched] = useState(false)   // 사용자가 금액을 직접 수정했는지
  const [currency,  setCurrency]  = useState('KRW')
  const [memo,      setMemo]      = useState('')
  const [available, setAvailable] = useState<'가용' | '불가용'>('가용')

  // 운용자금 / 국채
  const [bank,     setBank]     = useState('')
  const [product,  setProduct]  = useState('정기예금')
  const [rate,     setRate]     = useState('')
  const [start,    setStart]    = useState(today)
  const [maturity, setMaturity] = useState('')

  // 국채·채권
  const [bondName,  setBondName]  = useState('')
  const [bondIsin,  setBondIsin]  = useState('')
  const [bondQty,   setBondQty]   = useState('')
  const [bondPrice, setBondPrice] = useState('')

  // 지분 (상장/비상장)
  const [eqName,   setEqName]   = useState('')
  const [eqTicker, setEqTicker] = useState('')
  const [eqMarket, setEqMarket] = useState<'KOSPI' | 'KOSDAQ'>('KOSDAQ')
  const [shares,   setShares]   = useState('')
  const [price,    setPrice]    = useState('')
  const [purpose,  setPurpose]  = useState('단순투자')
  const [eqDate,   setEqDate]   = useState(reportDate ?? today)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const isEquity = dest === 'listed' || dest === 'unlisted'

  // 수량 × 단가로 계산되는 금액 (사용자가 금액을 직접 고치기 전까지 자동 동기화)
  const autoAmount =
    isEquity   ? parseNum(shares) * parseNum(price)
    : dest === 'bond' ? calcBondValue(parseNum(bondQty), parseNum(bondPrice))
    : 0

  const amount = amtTouched || autoAmount <= 0 ? parseNum(amtStr) : autoAmount

  function changeDest(next: Dest) {
    setDest(next)
    setAvailable(DEFAULT_AVAILABLE[next])
    setError(null)
    if (next !== 'invest') setCurrency('KRW')   // 지분·국채는 원화 기준으로만 관리
  }

  async function handleSave() {
    setError(null)
    // ── 검증 ──
    if (amount <= 0) { setError('금액을 입력하세요'); return }
    if (dest === 'invest') {
      if (!bank.trim())  { setError('금융기관명을 입력하세요'); return }
      if (!maturity)     { setError('만기일을 입력하세요'); return }
    } else if (dest === 'bond') {
      if (!bondName.trim())      { setError('채권명을 입력하세요'); return }
      if (parseNum(bondQty) <= 0) { setError('좌수를 입력하세요'); return }
      if (!maturity)             { setError('만기일을 입력하세요'); return }
    } else {
      if (!eqName.trim())        { setError('종목명을 입력하세요'); return }
      if (parseNum(shares) <= 0) { setError('주식수를 입력하세요'); return }
      if (parseNum(price) <= 0)  { setError('취득단가를 입력하세요'); return }
    }

    setSaving(true)
    try {
      const newId = generateUUID()
      let linkedType: string
      let defaultMemo: string

      if (isEquity) {
        // ── 지분/장기투자 → equities ──
        // total_value = 주식수 × 단가(평가액), acquisition_cost = 실제 지급액(=출금액)
        const sh = parseNum(shares), pr = parseNum(price)
        const { error: e } = await restInsert('equities', {
          id:               newId,
          company,
          name:             eqName.trim(),
          ticker:           dest === 'listed' ? eqTicker.trim() : '',
          market:           dest === 'listed' ? eqMarket : '비상장',
          purpose,
          available,
          shares:           sh,
          price:            pr,
          total_value:      sh * pr,
          date:             eqDate,
          acquisition_cost: amount,
        })
        if (e) throw new Error(e.message)
        linkedType  = 'equity'
        defaultMemo = `${eqName.trim()} ${sh.toLocaleString('ko-KR')}주 @${pr.toLocaleString('ko-KR')}`
      } else {
        // ── 운용자금 / 국채 → investments (investToDb 로 start→start_date 매핑) ──
        const isBond = dest === 'bond'
        const payload = investToDb({
          id:               newId,
          company,
          bank:             isBond ? (bank.trim() || bondName.trim()) : bank.trim(),
          product:          isBond ? '국채' : product,
          currency,
          amount,
          available,
          rate:             Number(rate) || 0,
          start,                      // ← investToDb 가 start_date 로 변환
          maturity,
          active:           true,
          acquisition_cost: amount,
          ...(isBond ? {
            bondName:   bondName.trim(),
            bondTicker: bondIsin.trim(),
            bondQty:    parseNum(bondQty),
            bondPrice:  parseNum(bondPrice),
          } : {}),
        })
        const { error: e } = await restInsert('investments', payload)
        if (e) throw new Error(e.message)
        linkedType  = 'investment'
        defaultMemo = isBond
          ? `${bondName.trim()} ${parseNum(bondQty).toLocaleString('ko-KR')}좌`
          : `${bank.trim()} ${product} 투자집행`
      }

      await onSaved(amount, currency, memo.trim() || defaultMemo, linkedType, newId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]" style={{ animation: 'fadeInScale 0.18s ease-out both' }}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📈 투자 집행 연동</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">자산을 등록하고 일보 출금 항목에 자동 연동합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {/* ── 자산 구분 선택 ── */}
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-300 mb-1.5">자산 구분 <span className="text-red-400">*</span></p>
            <div className="grid grid-cols-2 gap-1.5">
              {DESTS.map(d => (
                <button key={d.key} onClick={() => changeDest(d.key)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                    dest === d.key
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-500 dark:text-indigo-300'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-600'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              ↳ {DESTS.find(d => d.key === dest)!.hint}
            </p>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-700 pt-3 space-y-3">
            {/* ── 운용자금 ── */}
            {dest === 'invest' && (
              <>
                <Row label="금융기관" req>
                  <input type="text" value={bank} onChange={e => setBank(e.target.value)}
                    placeholder="예: 국민은행" className={inputCls} />
                </Row>
                <Row label="상품 유형">
                  <select value={product} onChange={e => setProduct(e.target.value)} className={inputCls}>
                    {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Row>
                <Row label="금액" req>
                  <NumInput value={amtStr} placeholder="투자금액"
                    onChange={s => { setAmtStr(s); setAmtTouched(true) }} />
                </Row>
                <Row label="통화">
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
                    {['KRW', 'USD', 'EUR', 'JPY'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Row>
                <Row label="금리 (%)">
                  <input type="text" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)}
                    placeholder="예: 3.8" className={inputCls} />
                </Row>
                <Row label="시작일" req>
                  <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
                </Row>
                <Row label="만기일" req>
                  <input type="date" value={maturity} onChange={e => setMaturity(e.target.value)} className={inputCls} />
                </Row>
              </>
            )}

            {/* ── 국채·채권 ── */}
            {dest === 'bond' && (
              <>
                <Row label="채권명" req>
                  <input type="text" value={bondName} onChange={e => setBondName(e.target.value)}
                    placeholder="예: 국고02625-5503(25-2)" className={inputCls} />
                </Row>
                <Row label="ISIN">
                  <input type="text" value={bondIsin} onChange={e => setBondIsin(e.target.value)}
                    placeholder="예: KR103502GF39 (선택)" className={inputCls} />
                </Row>
                <Row label="취급기관">
                  <input type="text" value={bank} onChange={e => setBank(e.target.value)}
                    placeholder="증권사 (선택)" className={inputCls} />
                </Row>
                <Row label="좌수" req>
                  <NumInput value={bondQty} onChange={setBondQty} placeholder="예: 7,619,957" />
                </Row>
                <Row label="기준가" req>
                  <NumInput value={bondPrice} onChange={setBondPrice} placeholder="액면 10,000 기준 · 예: 7,023" />
                </Row>
                <Row label="만기일" req>
                  <input type="date" value={maturity} onChange={e => setMaturity(e.target.value)} className={inputCls} />
                </Row>
              </>
            )}

            {/* ── 상장 / 비상장 주식 ── */}
            {isEquity && (
              <>
                <Row label="종목명" req>
                  <input type="text" value={eqName} onChange={e => setEqName(e.target.value)}
                    placeholder={dest === 'listed' ? '예: 메디아나' : '예: (주)〇〇〇 RCPS'} className={inputCls} />
                </Row>
                {dest === 'listed' && (
                  <>
                    <Row label="시장">
                      <select value={eqMarket} onChange={e => setEqMarket(e.target.value as 'KOSPI' | 'KOSDAQ')} className={inputCls}>
                        <option value="KOSDAQ">KOSDAQ</option>
                        <option value="KOSPI">KOSPI</option>
                      </select>
                    </Row>
                    <Row label="종목코드">
                      <input type="text" value={eqTicker} onChange={e => setEqTicker(e.target.value)}
                        placeholder="예: 041920 (선택)" className={inputCls} />
                    </Row>
                  </>
                )}
                <Row label="주식수" req>
                  <NumInput value={shares} onChange={setShares} placeholder="예: 21,276" />
                </Row>
                <Row label="취득단가" req>
                  <NumInput value={price} onChange={setPrice} placeholder="예: 47,000" />
                </Row>
                <Row label="취득목적">
                  <select value={purpose} onChange={e => setPurpose(e.target.value)} className={inputCls}>
                    {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Row>
                <Row label="기준일" req>
                  <input type="date" value={eqDate} onChange={e => setEqDate(e.target.value)} className={inputCls} />
                </Row>
              </>
            )}

            {/* ── 자동계산 금액 (국채·지분 공통) ── */}
            {dest !== 'invest' && (
              <>
                <Row label="출금액" req>
                  <div className="w-full">
                    {amtTouched
                      ? <NumInput value={amtStr} onChange={setAmtStr} placeholder="실제 지급액" />
                      : <input type="text" readOnly value={autoAmount > 0 ? autoAmount.toLocaleString('ko-KR') : ''}
                          placeholder="수량 × 단가 자동계산" className={roCls + ' text-right tabular-nums'} />}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-400">
                        {isEquity ? '주식수 × 취득단가' : '좌수 × 기준가 ÷ 10'} 자동계산
                      </span>
                      <button
                        onClick={() => {
                          if (amtTouched) { setAmtTouched(false) }
                          else { setAmtStr(fmtComma(autoAmount)); setAmtTouched(true) }
                        }}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400">
                        {amtTouched ? '↺ 자동계산으로' : '✎ 직접 입력 (수수료 등)'}
                      </button>
                    </div>
                  </div>
                </Row>
                {amtTouched && autoAmount > 0 && amount !== autoAmount && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-[92px]">
                    ⚠ 자동계산({autoAmount.toLocaleString('ko-KR')})과 {Math.abs(amount - autoAmount).toLocaleString('ko-KR')}원 차이
                    — 평가액은 수량×단가, 취득원가는 입력하신 출금액으로 기록됩니다.
                  </p>
                )}
              </>
            )}

            {/* ── 가용여부 (공통) ── */}
            <Row label="가용여부">
              <div className="flex gap-1.5 w-full">
                {(['가용', '불가용'] as const).map(v => (
                  <button key={v} onClick={() => setAvailable(v)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      available === v
                        ? v === '가용'
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-600 dark:text-emerald-300'
                          : 'bg-amber-50 border-amber-400 text-amber-700 dark:bg-amber-950/40 dark:border-amber-600 dark:text-amber-300'
                        : 'bg-white border-gray-200 text-gray-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
                    }`}>
                    {v}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="메모">
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                placeholder="메모 (선택)" className={inputCls} />
            </Row>
          </div>

          {error && <p className="text-xs text-red-500 pt-1">{error}</p>}
        </div>

        {/* 저장 */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">취소</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="text-xs px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-indigo-700">
            {saving ? '저장 중…' : '📈 투자 집행 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
