/**
 * 환율효과 추적 (2026-09-09, Phase 2)
 *
 * 외화 환산액이 변한 것이 **돈이 움직여서인지 환율이 움직여서인지**를 갈라 보여준다.
 * 총액은 저장된 daily.fx_krw 가 정본이고, ECOS 환율은 그 안에서 통화별 기여를
 * 나누는 데에만 쓴다. 맞지 않는 몫은 감추지 않고 '설명 안 됨'으로 드러낸다.
 */
import { fmtKRW } from '../../lib/format'
import { isMaterial, type FxEffectResult } from '../../lib/fxEffect'

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmtKRW(Math.abs(n))}`
const toneOf = (n: number) =>
  n > 0 ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'
const fmtRate = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFx = (n: number, code: string) =>
  `${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${code}`

export default function FxEffectView({ effect }: { effect: FxEffectResult | null }) {
  if (!effect) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6 text-sm text-gray-500 dark:text-slate-400">
        환율 이력을 불러오는 중입니다. 계속 이 화면이 보이면 <code>fx_rate_history</code> 에
        데이터가 없는 것입니다 — 환율 현황 화면에서 백필을 먼저 실행하세요.
      </div>
    )
  }

  const shown = effect.currencies.filter(isMaterial)
  const total = effect.tradeEffect + effect.fxEffect + effect.crossEffect
  const max = Math.max(
    Math.abs(effect.tradeEffect), Math.abs(effect.fxEffect),
    Math.abs(effect.crossEffect), Math.abs(effect.residual), 1,
  )

  return (
    <div className="space-y-4">
      {/* 요약 — 세 갈래 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-100">
            외화 환산액은 왜 변했나
          </h3>
          <span className={`text-lg font-bold tabular-nums ${toneOf(effect.observedKrwDelta)}`}>
            {signed(effect.observedKrwDelta)}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-4">
          {effect.from} → {effect.to} · 운전자금 외화의 원화환산액 변동
        </p>

        <div className="space-y-2.5">
          <Bar label="거래효과" value={effect.tradeEffect} max={max}
            hint="외화가 실제로 늘거나 줄어서" />
          <Bar label="환율효과" value={effect.fxEffect} max={max}
            hint="가만히 있었는데 환율이 움직여서" accent />
          <Bar label="교차항" value={effect.crossEffect} max={max}
            hint="기중 증감분에 붙은 환율 변동" />
          {Math.abs(effect.residual) > 0.5 && (
            <Bar label="설명 안 됨" value={effect.residual} max={max} muted
              hint="입력 당시 환율과 ECOS 매매기준율의 차이" />
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700 text-[11px] text-gray-400 dark:text-slate-500 space-y-1">
          <p>
            총액(<span className="tabular-nums">{signed(effect.observedKrwDelta)}</span>)은
            자금일보에 저장된 값 그대로입니다. 환율은 그 안에서 통화별 몫을 나누는 데만 썼습니다 —
            분해 합계 <span className="tabular-nums">{signed(total)}</span>.
          </p>
          {effect.missingCurrencies.length > 0 && (
            <p className="text-amber-600 dark:text-amber-400">
              {effect.missingCurrencies.join(', ')} 는 환율 이력이 없어 분해하지 못했습니다 —
              그 몫은 ‘설명 안 됨’에 포함돼 있습니다.
            </p>
          )}
        </div>
      </div>

      {/* 통화별 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-300">
              <th className="text-left  px-3 py-2.5">통화</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">기초 잔액</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">기말 잔액</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">기초 환율</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">기말 환율</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">거래효과</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">환율효과</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">교차항</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">합계</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.currency} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-2 font-medium text-gray-700 dark:text-slate-200">
                  {c.currency}
                  {c.missingRate && (
                    <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">환율 이력 없음</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-slate-400">
                  {fmtFx(c.openAmount, c.currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-slate-400">
                  {fmtFx(c.closeAmount, c.currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtRate(c.openRate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtRate(c.closeRate)}
                  {c.rateDelta !== null && c.rateDelta !== 0 && (
                    <span className={`ml-1 text-[10px] ${toneOf(c.rateDelta)}`}>
                      {c.rateDelta > 0 ? '▲' : '▼'}{Math.abs(c.rateDelta).toFixed(2)}
                    </span>
                  )}
                </td>
                <Cell v={c.tradeEffect} />
                <Cell v={c.fxEffect} bold />
                <Cell v={c.crossEffect} />
                <Cell v={c.totalEffect} bold />
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-400">
                이 기간에 환율효과가 1천만원 이상인 통화가 없습니다.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        환산 1천만원 미만인 통화는 표에서 생략합니다. 실현·미실현 환차손익은
        외화거래명세의 FIFO 원장에서 확인하세요.
      </p>
    </div>
  )
}

function Cell({ v, bold }: { v: number | null; bold?: boolean }) {
  if (v === null) return <td className="px-3 py-2 text-right text-gray-300 dark:text-slate-600">—</td>
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${toneOf(v)}`}>
      {v === 0 ? '—' : signed(v)}
    </td>
  )
}

function Bar({ label, value, max, hint, muted, accent }: {
  label: string; value: number; max: number; hint: string; muted?: boolean; accent?: boolean
}) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <div className={`text-xs ${accent ? 'font-semibold text-gray-700 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}`}>
          {label}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{hint}</div>
      </div>
      <div className="flex-1 h-5 bg-gray-100 dark:bg-slate-700/50 rounded">
        <div
          className={`h-full rounded ${
            muted ? 'bg-gray-400 dark:bg-slate-500'
                  : value >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-32 text-right text-xs font-semibold tabular-nums ${muted ? 'text-gray-500' : toneOf(value)}`}>
        {signed(value)}
      </span>
    </div>
  )
}
