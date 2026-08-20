import { useMemo, useState } from 'react'
import { fmtNumber } from '../../lib/format'
import { ACCOUNT_TYPE_LABEL, type FxAccountType, type FxLot } from '../../lib/fxLots'
import type { FxCode, InvestmentRecord } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const FIELD = 'mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const DEST: FxAccountType[] = ['demand_deposit', 'mmda', 'term_deposit']

function todayStr() { return new Date().toISOString().slice(0, 10) }

/**
 * 정기예금 라이프사이클 + 운용자금 연동 (세션26차 Phase 2).
 *
 * 정기예금은 **두 장부에 동시에 존재**한다 —
 *   `investments` = 계약 조건(은행·금리·만기)과 만기 처리 여부의 정본
 *   `fx_lots`     = 외화 원가(장부환율)·FIFO 순서·환전 가능 여부의 정본
 * 그런데 서로 참조하는 컬럼이 없어 따로 놀고 있었다(메디아나 USD 2026-03-17 건은
 * 이미 해지됐는데 원장엔 흔적이 없었다). 이 카드가 둘을 잇는다.
 *
 * ⚠ 해지는 [원금 대체 + 이자 신규 로트]를 서버가 한 트랜잭션으로 처리한다.
 *   이자는 **새로 생긴 외화**라 해지일 환율의 신규 로트여야 한다 — 원금 장부환율로
 *   넣으면 원가가 희석된다.
 * ⚠ 운용자금(`investments`) 쪽 만기처리는 **여기서 하지 않는다.** 자체 감사 로그가 있는
 *   별도 도메인이라, 원장 반영 후 안내만 하고 실제 처리는 운용자금 화면에서 하도록 한다.
 */
export default function FxTermDepositCard({
  lots, currency, investments, canEdit, userCode, onSettle, onLink, onChanged,
}: {
  lots: FxLot[]
  currency: FxCode
  /** 이 법인·통화의 운용자금 정기예금(활성) */
  investments: InvestmentRecord[]
  canEdit: boolean
  userCode: string
  onSettle: (input: {
    date: string; principal: number; toAccountType: FxAccountType
    interest: number; interestRate: number | null
    maturityDate: string | null; annualInterestRate: number
    transferRate: number | null; allowEarly: boolean
    investmentId: string | null; memo: string; userCode: string
  }) => Promise<string | null>
  onLink: (lotIds: string[], investmentId: string, userCode: string) => Promise<string | null>
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayStr())
  const [principal, setPrincipal] = useState(0)
  const [dest, setDest] = useState<FxAccountType>('demand_deposit')
  const [interest, setInterest] = useState(0)
  const [interestRate, setInterestRate] = useState(0)
  const [maturity, setMaturity] = useState('')
  const [annualRate, setAnnualRate] = useState(0)
  const [investmentId, setInvestmentId] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [linkTarget, setLinkTarget] = useState<string>('')   // 매핑할 investments.id

  const today = todayStr()
  const termLots = useMemo(
    () => lots.filter(l => l.accountType === 'term_deposit' && l.remainingAmount > 0)
      .sort((a, b) => (a.maturityDate ?? '').localeCompare(b.maturityDate ?? '')), [lots])
  const termTotal = termLots.reduce((s, l) => s + l.remainingAmount, 0)
  const investTotal = investments.reduce((s, i) => s + (i.amount ?? 0), 0)
  // 정합성 — 두 장부가 다시 벌어지지 않게 하는 안전장치
  const mismatch = Math.abs(termTotal - investTotal) > 0.5
  const unlinked = termLots.filter(l => !l.investmentId)

  const matured = termLots.filter(l => !!l.maturityDate && l.maturityDate <= date)
  const maturedTotal = matured.reduce((s, l) => s + l.remainingAmount, 0)
  const earlyNeeded = principal > maturedTotal + 0.000001

  const invalid =
    !(principal > 0) ? '해지 원금을 입력하세요.'
    : principal > termTotal + 0.000001 ? '정기예금 잔액을 초과합니다.'
    : dest === 'term_deposit' && !maturity ? '재예치 만기일을 입력하세요.'
    : interest > 0 && !(interestRate > 0) ? '이자를 등록하려면 해지일 환율이 필요합니다.'
    : null

  async function submit() {
    if (invalid) { setMsg(invalid); return }
    setSaving(true)
    const err = await onSettle({
      date, principal, toAccountType: dest,
      interest, interestRate: interest > 0 ? interestRate : null,
      maturityDate: dest === 'term_deposit' ? maturity : null,
      annualInterestRate: dest === 'demand_deposit' ? 0 : annualRate,
      transferRate: null, allowEarly: earlyNeeded,
      investmentId: investmentId || null, memo, userCode,
    })
    setSaving(false)
    if (err) { setMsg(err); return }
    setMsg(dest === 'term_deposit'
      ? '해지·재예치를 원장에 반영했습니다. 운용자금 화면에서 기존 예금 만기처리와 신규 등록도 함께 진행하세요.'
      : '해지를 원장에 반영했습니다. 운용자금 화면에서 해당 예금 만기처리도 함께 진행하세요.')
    setOpen(false); setPrincipal(0); setInterest(0); setInterestRate(0); setMemo('')
    onChanged()
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">🏦 정기예금 관리</div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
            해지 시 <strong>원금은 계좌 대체(원가승계), 이자는 해지일 환율의 신규 로트</strong>로 기록됩니다.
          </p>
        </div>
        {canEdit && termLots.length > 0 && (
          <button onClick={() => { setOpen(o => !o); setMsg(null) }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
            {open ? '닫기' : '해지 · 재예치'}
          </button>
        )}
      </div>

      {/* 정합성 점검 — 원장 term_deposit 합계 vs 운용자금 외화 정기예금 활성 합계 */}
      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${mismatch
        ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
        : 'border-gray-200 dark:border-slate-700'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
          <span className="font-medium text-gray-700 dark:text-slate-200">
            {mismatch ? '⚠ 두 장부 잔액이 다릅니다' : '✅ 원장 ↔ 운용자금 잔액 일치'}
          </span>
          <span className="text-gray-500 dark:text-slate-400">
            원장 {fmtNumber(termTotal, currency === 'JPY' ? 0 : 2)} · 운용자금 {fmtNumber(investTotal, currency === 'JPY' ? 0 : 2)} {currency}
          </span>
        </div>
        {mismatch && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            한쪽만 해지·예치 처리됐을 수 있습니다. 아래 목록과 운용자금 화면을 대조하세요.
          </p>
        )}
      </div>

      {termLots.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">보유 중인 정기예금 로트가 없습니다.</p>
      ) : (
        <table className="mt-3 w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="font-medium">취득일</th>
              <th className="font-medium">만기</th>
              <th className="text-right font-medium">잔액</th>
              <th className="text-right font-medium">장부환율</th>
              <th className="font-medium">운용자금 연결</th>
            </tr>
          </thead>
          <tbody className="text-gray-700 dark:text-slate-300">
            {termLots.map(l => {
              const due = !!l.maturityDate && l.maturityDate <= today
              return (
                <tr key={l.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1.5">{l.acquiredDate}</td>
                  <td className={due ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}>
                    {l.maturityDate ?? '—'}{due && ' (만기)'}
                  </td>
                  <td className="text-right">{fmtNumber(l.remainingAmount, currency === 'JPY' ? 0 : 2)}</td>
                  <td className="text-right">{fmtNumber(l.acqRate, 2)}</td>
                  <td className="text-[11px]">
                    {l.investmentId
                      ? <span className="text-green-600 dark:text-green-400">연결됨</span>
                      : <span className="text-gray-400">미연결</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* 1회 수동 매핑 — 이미 양쪽에 따로 들어가 있는 건을 잇는다 */}
      {canEdit && unlinked.length > 0 && investments.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500 dark:text-slate-400">미연결 {unlinked.length}건을 운용자금에 연결:</span>
          <select value={linkTarget} onChange={e => setLinkTarget(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800">
            <option value="">운용자금 선택</option>
            {investments.map(i => (
              <option key={i.id} value={i.id}>
                {i.bank} · {fmtNumber(i.amount ?? 0, 0)} · 만기 {i.maturity ?? '—'}
              </option>
            ))}
          </select>
          <button disabled={!linkTarget}
            onClick={async () => {
              const err = await onLink(unlinked.map(l => l.id), linkTarget, userCode)
              setMsg(err ?? `${unlinked.length}건을 연결했습니다.`)
              if (!err) { setLinkTarget(''); onChanged() }
            }}
            className="rounded bg-gray-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-600">
            연결
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-200 pt-3 dark:border-slate-700">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">해지일<input type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} /></label>
            <label className="text-xs">해지 원금 ({currency})
              <input type="number" min={0} value={principal || ''} onChange={e => setPrincipal(Number(e.target.value))}
                className={`${FIELD} text-right tabular-nums`} />
            </label>
            <label className="text-xs">원금 행선지
              <select value={dest} onChange={e => setDest(e.target.value as FxAccountType)} className={FIELD}>
                {DEST.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}{t === 'term_deposit' ? ' (재예치)' : ''}</option>)}
              </select>
            </label>
            <label className="text-xs">연결 운용자금 (선택)
              <select value={investmentId} onChange={e => setInvestmentId(e.target.value)} className={FIELD}>
                <option value="">없음</option>
                {investments.map(i => <option key={i.id} value={i.id}>{i.bank} · 만기 {i.maturity ?? '—'}</option>)}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">이자 수취액 ({currency})
              <input type="number" min={0} value={interest || ''} onChange={e => setInterest(Number(e.target.value))}
                className={`${FIELD} text-right tabular-nums`} />
            </label>
            {interest > 0 && (
              <label className="text-xs">해지일 환율 (이자 장부환율)
                <input type="number" min={0} step="0.01" value={interestRate || ''} onChange={e => setInterestRate(Number(e.target.value))}
                  className={`${FIELD} text-right tabular-nums`} />
              </label>
            )}
            {dest === 'term_deposit' && (
              <label className="text-xs">재예치 만기일
                <input type="date" min={date} value={maturity} onChange={e => setMaturity(e.target.value)} className={FIELD} />
              </label>
            )}
            {dest !== 'demand_deposit' && (
              <label className="text-xs">연이율 (%)
                <input type="number" min={0} step="0.01" value={annualRate || ''} onChange={e => setAnnualRate(Number(e.target.value))}
                  className={`${FIELD} text-right tabular-nums`} />
              </label>
            )}
          </div>

          <label className="block text-xs">메모
            <input value={memo} onChange={e => setMemo(e.target.value)} className={FIELD}
              placeholder="예: 기업은행 외화 정기예금 만기 해지" />
          </label>

          <div className="rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-slate-600">
            <p className="font-semibold text-gray-700 dark:text-slate-200">처리 예정</p>
            <ul className="mt-1 space-y-0.5 text-gray-600 dark:text-slate-300 tabular-nums">
              <li>· 원금 {fmtNumber(principal, currency === 'JPY' ? 0 : 2)} {currency} → {ACCOUNT_TYPE_LABEL[dest]} 대체 (장부환율 승계, 손익 0)</li>
              {interest > 0 && (
                <li>· 이자 {fmtNumber(interest, currency === 'JPY' ? 0 : 2)} {currency} → 신규 로트 @{fmtNumber(interestRate, 2)} (해지일 취득)</li>
              )}
              <li className="text-gray-400">· 만기 도래분 {fmtNumber(maturedTotal, currency === 'JPY' ? 0 : 2)} {currency}
                {earlyNeeded && <span className="text-amber-600 dark:text-amber-400"> — 초과분은 중도해지로 처리됩니다</span>}
              </li>
            </ul>
          </div>

          {invalid && <p className="text-xs text-amber-600 dark:text-amber-400">{invalid}</p>}
          <div className="flex gap-2">
            <button onClick={() => void submit()} disabled={!!invalid || saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? '처리 중…' : '해지 실행'}
            </button>
            <button onClick={() => setOpen(false)} className="rounded border px-3 py-1.5 text-xs dark:border-slate-600">취소</button>
          </div>
        </div>
      )}

      {msg && <p className="mt-2 text-[11px] font-medium text-blue-700 dark:text-blue-300">{msg}</p>}
    </div>
  )
}
