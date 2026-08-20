import { useMemo, useState } from 'react'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { ACCOUNT_TYPE_LABEL, previewFifoConsumption, type FxAccountType, type FxLot } from '../../lib/fxLots'
import type { FxLotTransfer } from '../../hooks/useFxTransfers'
import type { FxCode } from '../../types'

const ACCOUNT_TYPES: FxAccountType[] = ['demand_deposit', 'mmda', 'term_deposit']
const FIELD = 'mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

function todayStr() { return new Date().toISOString().slice(0, 10) }

/**
 * 계좌 간 대체 (세션26차 12일차).
 *
 * ⭐ 매각·지급과 근본적으로 다르다: 외화가 밖으로 나가지 않는 **내부 이동**이라
 *   총 외화 잔액이 변하지 않는다. 그래서 유출/유입을 따로 등록하면 안 되고
 *   (그러면 잔액이 잠깐 어긋나고 손익도 두 번 잡힌다) 서버가 한 트랜잭션으로
 *   [FIFO 소진 + 신규 로트 생성]을 함께 처리한다.
 *
 * 다루는 실무 케이스:
 *   보통예금 ↔ MMDA 계좌대체 / 보통예금·MMDA → 정기예금 예치 /
 *   정기예금 해지(→ 보통예금·MMDA) / 해지 후 재예치(정기예금 → 정기예금)
 *
 * 평가 방식은 법인 정책(policy_params.fx_transfer_valuation)이 정한다 — 화면에서
 * 바꿀 수 없고, 저장 전에 그 방식의 결과(손익 0 vs 실현손익 N)를 보여주기만 한다.
 */
export default function FxTransferCard({ lots, currency, valuationMethod, canEdit, userCode, transfers, onTransfer, onReverse, onChanged }: {
  lots: FxLot[]
  currency: FxCode
  /** 'carryover'(원가승계, 기본) | 'revalue'(재평가) — 법인 정책 */
  valuationMethod: 'carryover' | 'revalue'
  canEdit: boolean
  userCode: string
  /** 대체 이력 — 원장 표에서는 취득일 승계 때문에 눈에 안 띄므로 이벤트 단위로도 보여준다 */
  transfers: FxLotTransfer[]
  onTransfer: (input: {
    date: string; fromAccountType: FxAccountType; toAccountType: FxAccountType
    amount: number; maturityDate: string | null; annualInterestRate: number
    transferRate: number | null; allowEarly: boolean; memo: string; userCode: string
  }) => Promise<string | null>
  onReverse: (transferId: string, userCode: string) => Promise<string | null>
  onChanged: () => void
}) {
  const [reverseTarget, setReverseTarget] = useState<FxLotTransfer | null>(null)
  const [reversing, setReversing] = useState(false)
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayStr())
  const [from, setFrom] = useState<FxAccountType>('demand_deposit')
  const [to, setTo] = useState<FxAccountType>('term_deposit')
  const [amount, setAmount] = useState(0)
  const [maturity, setMaturity] = useState('')
  const [rateInput, setRateInput] = useState(0)
  const [interest, setInterest] = useState(0)
  const [allowEarly, setAllowEarly] = useState(false)
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const isRevalue = valuationMethod === 'revalue'

  // 출금 계좌유형의 로트만 대상. 정기예금은 만기 전이면 중도해지 체크가 있어야 잡힌다.
  const sourceLots = useMemo(
    () => lots.filter(l => l.accountType === from && l.remainingAmount > 0), [lots, from])
  const eligible = useMemo(() => sourceLots.filter(l =>
    from !== 'term_deposit' || allowEarly || (!!l.maturityDate && l.maturityDate <= date)),
    [sourceLots, from, allowEarly, date])
  const eligibleTotal = eligible.reduce((s, l) => s + l.remainingAmount, 0)

  // 미리보기 — 서버와 같은 규칙(유형 내 취득일 순). 유형을 이미 하나로 고정했으므로
  // 계좌유형 우선순위 정책은 여기서 의미가 없다.
  const preview = useMemo(() => {
    if (!(amount > 0)) return null
    const rows = previewFifoConsumption(
      eligible, amount, isRevalue ? rateInput : 0, allowEarly ? '9999-12-31' : date)
    const covered = rows.reduce((s, r) => s + r.amount, 0)
    const pnl = isRevalue && rateInput > 0
      ? rows.reduce((s, r) => s + (rateInput - r.acqRate) * r.amount, 0) : 0
    return { rows, covered, shortfall: Math.max(0, amount - covered), pnl }
  }, [eligible, amount, isRevalue, rateInput, allowEarly, date])

  const needMaturity = to === 'term_deposit'
  const invalid =
    !(amount > 0) ? '대체 금액을 입력하세요.'
    : needMaturity && !maturity ? '정기예금 만기일을 입력하세요.'
    : needMaturity && maturity < date ? '만기일이 대체일보다 빠릅니다.'
    : isRevalue && !(rateInput > 0) ? '재평가 방식이라 대체환율이 필요합니다.'
    : preview && preview.shortfall > 0 ? `${ACCOUNT_TYPE_LABEL[from]} 잔액이 부족합니다.`
    : null

  async function submit() {
    if (invalid) { setMsg(invalid); return }
    setSaving(true)
    const err = await onTransfer({
      date, fromAccountType: from, toAccountType: to, amount,
      maturityDate: needMaturity ? maturity : null,
      annualInterestRate: to === 'demand_deposit' ? 0 : interest,
      transferRate: isRevalue ? rateInput : null,
      allowEarly, memo, userCode,
    })
    setSaving(false)
    if (err) { setMsg(err); return }
    setMsg('계좌 대체를 등록했습니다.')
    setOpen(false); setAmount(0); setMemo(''); setRateInput(0); setAllowEarly(false)
    onChanged()
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">🔄 계좌 간 대체</div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
            보통예금 ↔ MMDA 이체, 정기예금 예치·해지·재예치. <strong>총 외화 잔액은 변하지 않습니다.</strong>
          </p>
        </div>
        {canEdit && (
          <button onClick={() => { setOpen(o => !o); setMsg(null) }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
            {open ? '닫기' : '대체 등록'}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
        평가 방식(법인 정책):{' '}
        <strong className={isRevalue ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-slate-200'}>
          {isRevalue ? '재평가 — 대체환율로 새 장부환율 적용, 실현손익 발생'
                     : '원가승계 — 장부환율·취득일 유지, 실현손익 0'}
        </strong>
        <span className="ml-1 text-gray-400">· 자금정책 › FX 정책 › ② 정책 기준에서 변경</span>
      </p>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">대체일
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} />
            </label>
            <label className="text-xs">출금 계좌
              <select value={from} onChange={e => setFrom(e.target.value as FxAccountType)} className={FIELD}>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="text-xs">입금 계좌
              <select value={to} onChange={e => setTo(e.target.value as FxAccountType)} className={FIELD}>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="text-xs">외화 금액 ({currency})
              <input type="number" min={0} value={amount || ''} onChange={e => setAmount(Number(e.target.value))}
                className={`${FIELD} text-right tabular-nums`} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {needMaturity && (
              <label className="text-xs">만기일
                <input type="date" min={date} value={maturity} onChange={e => setMaturity(e.target.value)} className={FIELD} />
              </label>
            )}
            {to !== 'demand_deposit' && (
              <label className="text-xs">연이율 (%)
                <input type="number" min={0} step="0.01" value={interest || ''} onChange={e => setInterest(Number(e.target.value))}
                  className={`${FIELD} text-right tabular-nums`} />
              </label>
            )}
            {isRevalue && (
              <label className="text-xs">대체환율
                <input type="number" min={0} step="0.01" value={rateInput || ''} onChange={e => setRateInput(Number(e.target.value))}
                  className={`${FIELD} text-right tabular-nums`} />
              </label>
            )}
            <label className="text-xs sm:col-span-2">메모
              <input value={memo} onChange={e => setMemo(e.target.value)} className={FIELD}
                placeholder="예: 국민은행 외화 정기예금 3개월 예치" />
            </label>
          </div>

          {from === 'term_deposit' && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={allowEarly} onChange={e => setAllowEarly(e.target.checked)} />
              중도해지 허용 — 만기 전 정기예금도 대상에 포함합니다
            </label>
          )}

          {/* 저장 전 미리보기 — 어느 로트가 어떻게 넘어가는지 확인시킨다 */}
          <div className="rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-slate-600">
            <p className="font-semibold text-gray-700 dark:text-slate-200">
              대체 미리보기 · {ACCOUNT_TYPE_LABEL[from]} → {ACCOUNT_TYPE_LABEL[to]}
            </p>
            <p className="mt-1 text-gray-500 dark:text-slate-400 tabular-nums">
              대상 잔액 {fmtNumber(eligibleTotal, currency === 'JPY' ? 0 : 2)} {currency}
              {from === 'term_deposit' && !allowEarly && <span className="ml-1 text-gray-400">(만기 도래분만)</span>}
            </p>
            {!preview ? (
              <p className="mt-1 text-gray-400">금액을 입력하면 소진될 로트를 보여줍니다.</p>
            ) : preview.shortfall > 0 ? (
              <p className="mt-1 text-red-600 dark:text-red-400">
                ⚠ {fmtNumber(preview.shortfall, currency === 'JPY' ? 0 : 2)} {currency} 부족합니다.
              </p>
            ) : (
              <>
                <table className="mt-1.5 w-full tabular-nums text-[11px]">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="font-medium">원 취득일</th>
                      <th className="text-right font-medium">이동 금액</th>
                      <th className="text-right font-medium">기존 장부환율</th>
                      <th className="text-right font-medium">이동 후 장부환율</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 dark:text-slate-300">
                    {preview.rows.map(r => (
                      <tr key={r.lotId}>
                        <td className="py-0.5">{r.acquiredDate}</td>
                        <td className="text-right">{fmtNumber(r.amount, currency === 'JPY' ? 0 : 2)}</td>
                        <td className="text-right">{fmtNumber(r.acqRate, 2)}</td>
                        <td className="text-right font-medium">
                          {isRevalue ? fmtNumber(rateInput, 2) : fmtNumber(r.acqRate, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-gray-500 dark:text-slate-400">
                  {isRevalue ? (
                    <>신규 로트 <strong>1건</strong>(취득일 {date}) 생성 · 실현손익{' '}
                      <strong className={preview.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                        {preview.pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(preview.pnl))}
                      </strong>
                    </>
                  ) : (
                    <>신규 로트 <strong>{preview.rows.length}건</strong> 생성 · 장부환율·취득일 승계 · <strong>실현손익 0</strong></>
                  )}
                </p>
              </>
            )}
          </div>

          {invalid && <p className="text-xs text-amber-600 dark:text-amber-400">{invalid}</p>}
          <div className="flex gap-2">
            <button onClick={() => void submit()} disabled={!!invalid || saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {saving ? '처리 중…' : '대체 실행'}
            </button>
            <button onClick={() => setOpen(false)} className="rounded border px-3 py-1.5 text-xs dark:border-slate-600">취소</button>
          </div>
        </div>
      )}

      {msg && <p className="mt-2 text-[11px] font-medium text-blue-700 dark:text-blue-300">{msg}</p>}

      {/* 대체 이력 — 원가승계 대체 로트는 원본의 취득일을 승계하므로 원장 표(유입일 정렬)에서
          목록 중간에 끼어 들어가 눈에 띄지 않는다. 이벤트 단위로 다시 보여주고, 원복도 여기서. */}
      {transfers.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-slate-700">
          <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">대체 이력</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            원가승계 대체 로트는 <strong>원본의 취득일을 승계</strong>합니다 — 원장 표에서는 대체일이 아니라
            원본 취득일 위치에 표시됩니다(FIFO 순서 보존).
          </p>
          <table className="mt-2 w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="font-medium">대체일</th>
                <th className="font-medium">이동</th>
                <th className="text-right font-medium">금액</th>
                <th className="font-medium">방식</th>
                <th className="text-right font-medium">실현손익</th>
                <th className="text-right font-medium">관리</th>
              </tr>
            </thead>
            <tbody className="text-gray-600 dark:text-slate-300">
              {transfers.map(t => (
                <tr key={t.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1">{t.transfer_date}</td>
                  <td className="whitespace-nowrap">
                    {ACCOUNT_TYPE_LABEL[t.from_account_type]} → {ACCOUNT_TYPE_LABEL[t.to_account_type]}
                    {t.early_withdrawal && <span className="ml-1 text-amber-600 dark:text-amber-400">중도해지</span>}
                  </td>
                  <td className="text-right">{fmtNumber(t.amount, currency === 'JPY' ? 0 : 2)}</td>
                  <td>{t.valuation_method === 'revalue' ? '재평가' : '원가승계'}</td>
                  <td className={t.realized_pnl === 0 ? 'text-right text-gray-400'
                    : `text-right ${t.realized_pnl > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {t.realized_pnl === 0 ? '0' : `${t.realized_pnl > 0 ? '▲' : '▼'} ${fmtKRW(Math.abs(t.realized_pnl))}`}
                  </td>
                  <td className="text-right">
                    {canEdit && (
                      <button onClick={() => { setReverseTarget(t); setMsg(null) }}
                        className="text-red-600 hover:underline dark:text-red-400">취소</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 원복 확인 — 화면 안 패널(window.confirm 금지 규칙) */}
      {reverseTarget && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
          <p className="text-xs font-bold text-red-800 dark:text-red-200">대체 취소 확인</p>
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            {reverseTarget.transfer_date} · {ACCOUNT_TYPE_LABEL[reverseTarget.from_account_type]} →{' '}
            {ACCOUNT_TYPE_LABEL[reverseTarget.to_account_type]} ·{' '}
            {fmtNumber(reverseTarget.amount, currency === 'JPY' ? 0 : 2)} {currency}
            <br />
            이 대체로 생긴 로트가 삭제되고 원본 로트 잔액이 복원됩니다.
            <strong> 생긴 로트가 이미 일부라도 소진됐으면 서버가 거부합니다.</strong>
          </p>
          <div className="mt-2 flex gap-2">
            <button disabled={reversing}
              onClick={async () => {
                setReversing(true)
                const err = await onReverse(reverseTarget.id, userCode)
                setReversing(false)
                if (err) { setMsg(err); return }
                setReverseTarget(null); setMsg('대체를 취소했습니다.'); onChanged()
              }}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {reversing ? '처리 중…' : '취소 실행'}
            </button>
            <button onClick={() => setReverseTarget(null)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
