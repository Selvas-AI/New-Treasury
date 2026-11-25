/**
 * BasketTargetsTable — 통화별 목표와 매도 몫 (2026-11-25 결정 D4)
 *
 * 바구니 목표는 통화별 목표의 보유 비중 가중평균이다(lib/fxBasketDecision.weightBasketTargets).
 * "왜 이 통화에서 이만큼 파는가"를 한 표로 보여 준다. 계산은 하지 않는다.
 */
import type { BasketCurrencyTarget } from '../../lib/fxBasketDecision'
import { regimeLabel } from '../../lib/fxRegime'
import { fmtKRW } from '../../lib/format'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export default function BasketTargetsTable({ targets, weightedTarget, leadTarget, leadCode }: {
  targets: BasketCurrencyTarget[]
  weightedTarget: number
  leadTarget: number | null
  leadCode: string
}) {
  if (targets.length === 0) return null
  const anySell = targets.some(t => t.sellKRW > 0)
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
            <th className="py-1.5">통화</th>
            <th className="py-1.5 text-right">구성비</th>
            <th className="py-1.5">국면</th>
            <th className="py-1.5 text-right">통화별 목표</th>
            <th className="py-1.5 text-right">기여(구성비×목표)</th>
            {anySell && <th className="py-1.5 text-right">리짐 매도 몫</th>}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {targets.map(t => (
            <tr key={t.code} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-1.5 font-medium text-gray-800 dark:text-slate-100">{t.code}</td>
              <td className="py-1.5 text-right">{t.sharePct.toFixed(1)}%</td>
              <td className="py-1.5 text-gray-600 dark:text-slate-300">
                {t.source === 'own' && t.signal ? regimeLabel(t.signal.regime.code) : `${leadCode} 목표 적용`}
                {t.source === 'own' && !t.anchorSet && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    title="기준수준 앵커가 없어 추세만으로 판정했습니다">앵커 없음</span>
                )}
                {t.source === 'lead' && (
                  <span className="ml-1 text-[10px] text-gray-400" title="환율 이력이 30영업일 미만이라 자체 판정을 못 했습니다">(이력 부족)</span>
                )}
              </td>
              <td className="py-1.5 text-right">{pct(t.targetRatio)}</td>
              <td className="py-1.5 text-right">{((t.sharePct / 100) * t.targetRatio * 100).toFixed(2)}%p</td>
              {anySell && <td className="py-1.5 text-right">{t.sellKRW > 0 ? fmtKRW(t.sellKRW) : '—'}</td>}
            </tr>
          ))}
          <tr className="font-semibold text-gray-800 dark:text-slate-100">
            <td className="py-1.5" colSpan={3}>바구니 목표 (가중평균)</td>
            <td className="py-1.5 text-right" colSpan={2}>{pct(weightedTarget)}</td>
            {anySell && <td className="py-1.5 text-right">{fmtKRW(targets.reduce((s, t) => s + t.sellKRW, 0))}</td>}
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
        통화마다 자기 국면으로 목표를 정하고 보유 구성비로 가중평균합니다. 목표가 높은(유리한 국면) 통화는 덜 팔고 낮은 통화는 더 팝니다.
        {leadTarget != null && Math.abs(leadTarget - weightedTarget) >= 0.0005 && (
          <> 참고: {leadCode} 판정만 썼다면 목표 {pct(leadTarget)}.</>
        )}
        {' '}매도 몫은 가용재고·분기 손실 한도 적용 전 금액입니다.
      </p>
    </div>
  )
}
