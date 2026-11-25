import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtKRW, fmtNumber } from '../../lib/format'
import type { RegimeOrderPayload, RegimeOrderShortfall } from '../../lib/fxRegimeOrder'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtKRW(Math.abs(v))}`
const dec = (code: string) => (code === 'JPY' ? 0 : 2)

/**
 * 바구니 리짐 권고 → 통화별 매각 지시 등록 패널.
 *
 * 세션26차 7일차: 조치 카드 바로 아래, 화면 최상단. 실행(체결)은 외화거래명세 한 곳뿐이다
 * — 여기서는 발의까지만 한다("발의는 여러 곳, 집행·추적은 한 곳").
 *
 * ⭐ 2026-11-25 (전수조사 F-01 정식): 조치 카드의 **통화별 배분표 그대로** 통화마다 한 건씩
 *   등록한다. 과거엔 바구니 총액을 현재 탭 통화 하나로 등록해 배분표와 맞지 않았다.
 *   payload 는 lib/fxRegimeOrder 의 buildRegimeOrderPayloads 가 만든다(화면에서 조립 금지).
 *
 * ⚠ window.confirm 을 쓰지 않는다 — 크롬이 반복 대화상자를 차단하면 즉시 false 를
 *   반환해 "버튼을 눌러도 아무 일도 안 일어나는" 상태가 된다(세션24차 실사고).
 */
export default function RegisterOrderPanel({ company, payloads, shortfalls, totalKRW, onRegister }: {
  company: string
  payloads: RegimeOrderPayload[]
  shortfalls: RegimeOrderShortfall[]
  totalKRW: number
  /** 순서대로 등록한다. 실패하면 이미 등록된 건수와 오류를 돌려준다 */
  onRegister: (payloads: RegimeOrderPayload[]) => Promise<{ done: number; error: string | null }>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const pnl = payloads.every(p => p.fx_pnl != null)
    ? payloads.reduce((t, p) => t + (p.fx_pnl ?? 0), 0) : null

  async function run() {
    setBusy(true)
    const r = await onRegister(payloads)
    setBusy(false)
    setConfirming(false)
    setMsg(r.error
      ? { ok: false, text: r.done > 0
          // ⚠ 부분 등록을 숨기지 않는다 — 어디까지 들어갔는지 알아야 중복 등록을 피한다
          ? `${payloads.length}건 중 ${r.done}건만 등록됐습니다 — ${r.error}. 외화거래명세에서 등록된 건을 확인하세요.`
          : `등록 실패: ${r.error}` }
      : { ok: true, text: `${r.done}건을 매각 지시로 등록했습니다 — 승인 후 체결하세요(기한 3영업일).` })
  }

  if (payloads.length === 0 && shortfalls.length === 0) return null

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">🧾 매각 지시 등록</div>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">
          조치 카드의 통화별 배분대로 통화마다 한 건씩 등록합니다 (기한: 등록일 +3영업일)
        </span>
        {!confirming && !msg && payloads.length > 0 && (
          <button type="button" onClick={() => setConfirming(true)}
            className="ml-auto rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">
            이 권고로 매각 지시 등록 ({payloads.length}건)
          </button>
        )}
      </div>

      {shortfalls.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {shortfalls.map(s => (
            <div key={s.code}>
              ⚠ {s.code}: 몫 {fmtNumber(s.wantFx, dec(s.code))} 중 {fmtNumber(s.gotFx, dec(s.code))} 만 등록 — {s.reason}
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-800 dark:bg-orange-950/30">
          <div className="font-semibold text-orange-800 dark:text-orange-300">등록 내용을 확인하세요</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] tabular-nums text-orange-900 dark:text-orange-200">
              <thead>
                <tr className="text-[11px] text-orange-700 dark:text-orange-300">
                  <th className="py-1 text-left font-medium">통화</th>
                  <th className="py-1 text-right font-medium">수량</th>
                  <th className="py-1 text-right font-medium">매도 예정 환율</th>
                  <th className="py-1 text-right font-medium">장부환율</th>
                  <th className="py-1 text-right font-medium">원화</th>
                  <th className="py-1 text-right font-medium">예상 손익</th>
                </tr>
              </thead>
              <tbody>
                {payloads.map(p => (
                  <tr key={p.currency} className="border-t border-orange-200/60 dark:border-orange-800/60">
                    <td className="py-1 font-semibold">{p.currency}</td>
                    <td className="py-1 text-right">{fmtNumber(p.amount_fx, dec(p.currency))}</td>
                    <td className="py-1 text-right">{fmtNumber(p.trade_rate, p.trade_rate < 100 ? 3 : 2)}</td>
                    <td className="py-1 text-right">{p.acq_rate != null ? fmtNumber(p.acq_rate, p.acq_rate < 100 ? 3 : 2) : '—'}</td>
                    <td className="py-1 text-right">{fmtKRW(p.amount_krw)}</td>
                    <td className="py-1 text-right">{p.fx_pnl != null ? signed(p.fx_pnl) : '—'}</td>
                  </tr>
                ))}
                <tr className="border-t border-orange-300 font-semibold dark:border-orange-700">
                  <td className="py-1">합계</td><td /><td /><td />
                  <td className="py-1 text-right">{fmtKRW(totalKRW)}</td>
                  <td className="py-1 text-right">{pnl != null ? signed(pnl) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-orange-700 dark:text-orange-300">
            구분: 리짐 권고 매각 · 이행 기한: 등록일 +3영업일 (환율과 무관하게 실행) · 분기 손실 한도 내 금액입니다.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="rounded border border-orange-300 px-3 py-1.5 font-medium text-orange-700 dark:border-orange-700 dark:text-orange-300">
              취소
            </button>
            <button type="button" onClick={() => void run()} disabled={busy}
              className="rounded bg-orange-600 px-3 py-1.5 font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
              {busy ? '등록 중…' : `매각 지시 ${payloads.length}건 등록`}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
          {msg.text}
          {msg.ok && (
            <Link to={`/fx-ledger/${company}?tab=orders`} className="ml-1.5 font-semibold underline">
              외화거래명세에서 승인·체결 →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
