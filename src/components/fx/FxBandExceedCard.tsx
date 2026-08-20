import { useState } from 'react'
import { fmtKRW, fmtNumber } from '../../lib/format'
import { addBizDays, todayStr } from '../../lib/bizDay'
import type { FxBandExceedResult } from '../../lib/fxBandExceed'
import type { FxCode } from '../../types'

/**
 * 정책 밴드 상한 초과 알림 + 매도 발의 카드 (세션26차 11일차).
 *
 * ⭐ 왜 이 카드가 필요한가: 초과분 매도 발의가 **자금정책 페이지에만** 있었다.
 *   자금정책은 권한이 있는 계정에만 열리는 메뉴라, 실무 담당자는 외화 비중이
 *   상한을 넘어도 발의할 방법이 없었다(2026-08-20 리포트).
 *   그래서 실무자가 매일 여는 화면(FX 리짐 전략 / 외화거래명세)에 같은 카드를 둔다.
 *   ⚠ 발의는 여러 화면에서 하되 **실행(승인·체결)은 외화거래명세 한 곳**이라는
 *     기존 원칙은 그대로다 — 이 카드는 발의까지만 한다.
 *
 * 표시 전용 컴포넌트. 데이터는 computeFxBandExceed(SSOT) 결과를 그대로 받는다.
 */
export default function FxBandExceedCard({ data, marketRates, canPropose, onPropose, footer }: {
  data: FxBandExceedResult
  /** 통화별 현재 시장환율 — 초과 원화액을 외화 수량으로 환산할 때 쓴다 */
  marketRates: Partial<Record<FxCode, number>>
  canPropose: boolean
  /** 발의 실행. 성공 시 null, 실패 시 에러 메시지 */
  onPropose: (input: { currency: FxCode; amountFx: number; rate: number; excessKRW: number }) => Promise<string | null>
  footer?: React.ReactNode
}) {
  const [target, setTarget] = useState<FxCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!data.configured) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        정책 밴드(외화 목표 비중)가 아직 설정되지 않아 상한 초과 여부를 판정할 수 없습니다 — 자금정책 회의에서 밴드를 의결해야 합니다.
      </div>
    )
  }

  const row = target ? data.rows.find(r => r.code === target) ?? null : null
  const rate = target ? marketRates[target] ?? 0 : 0
  const amountFx = row && rate > 0 ? Math.ceil(row.excessKRW / rate) : 0

  async function submit() {
    if (!target || !row || amountFx <= 0) return
    setBusy(true); setMsg(null)
    const err = await onPropose({ currency: target, amountFx, rate, excessKRW: row.excessKRW })
    setBusy(false)
    if (err) setMsg(err)
    else { setTarget(null); setDone(true) }
  }

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${data.over
      ? 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20'
      : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className={`text-sm font-semibold ${data.over
            ? 'text-orange-700 dark:text-orange-300' : 'text-gray-800 dark:text-slate-100'}`}>
            {data.over
              ? `⚠ 외화 보유가 정책 상한을 ${fmtKRW(data.excessKRW)} 초과했습니다`
              : '✅ 외화 보유가 정책 밴드 이내입니다'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 tabular-nums">
            현재 {data.ratio.toFixed(1)}% · 밴드 {data.min ?? '—'}~{data.max}% ·
            보유 {fmtKRW(data.holdingsKRW)} / 상한 {fmtKRW(data.ceilingKRW)}
          </p>
        </div>
      </div>

      {done && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950/30 dark:text-green-300">
          매도 발의를 등록했습니다 — 외화거래명세 › 외화매도이력에서 승인·체결하세요.
        </p>
      )}

      {data.rows.length > 0 && (
        <table className="mt-3 w-full text-xs tabular-nums">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left font-medium pb-1">통화</th>
              <th className="text-right font-medium pb-1">보유 외화</th>
              <th className="text-right font-medium pb-1">원화 환산</th>
              <th className="text-right font-medium pb-1">바구니 비중</th>
              <th className="text-right font-medium pb-1">초과 안분</th>
              <th className="text-center font-medium pb-1">조치</th>
            </tr>
          </thead>
          <tbody className="text-gray-700 dark:text-slate-300">
            {data.rows.map(r => (
              <tr key={r.code} className="border-t border-gray-100 dark:border-slate-700/60">
                <td className="py-1.5 font-semibold">{r.code}</td>
                <td className="py-1.5 text-right">{fmtNumber(r.nativeAmount, r.code === 'JPY' ? 0 : 2)}</td>
                <td className="py-1.5 text-right">{fmtKRW(r.krwAmount)}</td>
                <td className="py-1.5 text-right text-gray-500">{r.sharePct.toFixed(1)}%</td>
                <td className={`py-1.5 text-right ${data.over ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-gray-400'}`}>
                  {data.over ? fmtKRW(r.excessKRW) : '—'}
                </td>
                <td className="py-1.5 text-center">
                  {data.over && canPropose ? (
                    <button onClick={() => { setTarget(r.code); setMsg(null); setDone(false) }}
                      className="rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600">
                      매도 발의
                    </button>
                  ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 확인 패널 — window.confirm 을 쓰지 않는다.
          크롬이 반복 대화상자를 차단하면 즉시 false 를 반환해 "눌러도 아무 일 없는"
          상태가 되고 사용자는 이유를 알 수 없다(세션24차 실사고). */}
      {target && row && (
        <div className="mt-3 rounded-lg border border-orange-300 bg-white p-3 dark:border-orange-700 dark:bg-slate-800">
          <p className="text-xs font-semibold text-gray-800 dark:text-slate-100">💱 매도 발의 확인 — {target}</p>
          <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-slate-300 tabular-nums">
            <p>초과 안분액: {fmtKRW(row.excessKRW)}</p>
            <p>현재 시장환율: {rate > 0 ? `${fmtNumber(rate, 2)}원` : '조회 전 — 환율을 불러올 수 없어 발의할 수 없습니다'}</p>
            <p>발의 수량: <strong>{amountFx > 0 ? fmtNumber(amountFx, 0) : '—'} {target}</strong></p>
            <p className="text-gray-400">이행 기한: {addBizDays(todayStr(), 3)} (등록일 +3영업일, 환율과 무관하게 실행)</p>
          </div>
          {msg && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{msg}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setTarget(null)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 dark:border-slate-600 dark:text-slate-300">
              취소
            </button>
            <button onClick={submit} disabled={busy || amountFx <= 0}
              className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              {busy ? '등록 중…' : '매도 발의 등록'}
            </button>
          </div>
        </div>
      )}

      {footer}
    </div>
  )
}
