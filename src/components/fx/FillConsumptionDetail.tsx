import { fmtKRW, fmtNumber } from '../../lib/format'
import type { FxTradeFill, FxLotConsumption } from '../../types'

function pnlColor(v: number | null) {
  if (v == null) return 'text-gray-400 dark:text-slate-500'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

/**
 * 체결(fill) 1건 카드 — 체결 요약(수량·환율·손익) + 소진된 FIFO 로트 상세(장부환율→처분환율).
 *
 * 외화 원장 통합 탭(원장/매각 지시 관리)이 공유하는 프레젠테이션 컴포넌트.
 * 세션26차 3~4일차에 FxTradeHistoryPage 안에서만 쓰이던 것을 분리했다 — 중복 방지.
 */
export function FillConsumptionCard({ fill, index, label, consumptions, canReverse, onRequestReverse }: {
  fill: FxTradeFill
  index: number
  /** 기본 라벨("N차 체결") 대신 표시할 텍스트 — 원장 탭처럼 거래 그룹핑 없이 단독 표시할 때 사용 */
  label?: string
  consumptions: FxLotConsumption[]
  canReverse: boolean
  onRequestReverse: (fill: FxTradeFill) => void
}) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
            {label ?? `${index + 1}차 체결`}
          </span>
          <span className="text-gray-600 dark:text-slate-300">{fill.fill_date}</span>
          {fill.completed_by && <span className="text-gray-400">· {fill.completed_by}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-gray-700 dark:text-slate-200 font-medium">
            {fmtNumber(fill.amount_fx, fill.currency === 'JPY' ? 0 : 2)} {fill.currency} @ {fmtNumber(fill.completed_rate, 2)}
          </span>
          <span className={`font-semibold ${pnlColor(fill.realized_pnl)}`}>
            {fill.realized_pnl >= 0 ? '▲' : '▼'} {fmtKRW(Math.abs(fill.realized_pnl))}
          </span>
          {canReverse && (
            <button onClick={() => onRequestReverse(fill)}
              className="text-[11px] px-2 py-0.5 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30">
              이 체결만 취소
            </button>
          )}
        </div>
      </div>
      {consumptions.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 dark:text-slate-500">
              <th className="text-left font-medium px-3 py-1.5">소진 로트</th>
              <th className="text-right font-medium px-3 py-1.5">소진 수량</th>
              <th className="text-right font-medium px-3 py-1.5">장부환율</th>
              <th className="text-right font-medium px-3 py-1.5">처분환율</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {consumptions.map((c, j) => (
              <tr key={c.id}>
                <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400">로트 {j + 1}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-slate-300">
                  {fmtNumber(c.amount, fill.currency === 'JPY' ? 0 : 2)} {fill.currency}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtNumber(c.acq_rate, 2)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtNumber(c.disposal_rate, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
