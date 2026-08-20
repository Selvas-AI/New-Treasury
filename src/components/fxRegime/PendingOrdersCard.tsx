import { Link } from 'react-router-dom'
import { fmtNumber } from '../../lib/format'
import { bizDaysBetween, todayStr } from '../../lib/bizDay'
import { orderTypeLabel } from '../../lib/fxOrderType'
import type { FxTradeRecord } from '../../types'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

const STATUS_BADGE: Record<string, string> = {
  '발의':   'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  '승인':   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  '부분체결': 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
}

/**
 * 이행 중인 리짐 매각 지시 카드 (세션26차 8일차 후속).
 *
 * ⭐ 왜 필요한가: 조치 카드(RegisterOrderPanel)는 **지금 이 순간 신규 조치가 필요한지**만
 *   본다. 그런데 지시를 발의한 뒤 최대 3영업일에 걸쳐 부분 체결하는 도중에 잔여 보유
 *   비중이 이미 트리거 아래로 내려가면, 라이브 판정은 "조치 불필요"로 바뀌어 조치
 *   카드가 사라진다 — 그 순간 "1,000,000불 중 600,000불만 체결, 나머지 400,000불은
 *   어디서 확인하나"라는 질문에 답할 곳이 없었다(2026-08-19 실사용 리포트).
 *   판정 상태와 무관하게, 이 통화에 걸린 미완료 리짐 매각 지시가 있으면 항상 보여준다.
 *   실제 체결·취소는 외화거래명세에서만 한다("발의는 여러 곳, 집행·추적은 한 곳").
 */
export default function PendingOrdersCard({ company, currency, orders }: {
  company: string; currency: string; orders: FxTradeRecord[]
}) {
  if (orders.length === 0) return null
  const today = todayStr()

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
          🧾 이행 중인 매각 지시 ({currency})
        </div>
        <Link to={`/fx-ledger/${company}?tab=orders&currency=${currency}`}
          className="rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
          외화거래명세에서 체결·이력 확인 →
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {orders.map(o => {
          const filled = o.filled_amount ?? 0
          const remaining = Math.max(0, o.amount_fx - filled)
          const dday = o.due_date ? bizDaysBetween(today, o.due_date) : null
          return (
            <div key={o.id} className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_BADGE[o.status] ?? 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>
                  {o.status}
                </span>
                <span className="text-gray-500 dark:text-slate-400">{o.trade_date} 발의</span>
                <span className="text-gray-400">{orderTypeLabel(o.order_type)}</span>
                {dday != null && (
                  <span className={dday < 0 ? 'font-semibold text-red-600 dark:text-red-400' : dday === 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-gray-400'}>
                    {dday < 0 ? `기한초과 D+${Math.abs(dday)}` : dday === 0 ? 'D-day' : `D-${dday}`}
                  </span>
                )}
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 tabular-nums">
                <div>
                  <div className="text-[10px] text-gray-400">지시 수량</div>
                  <div className="font-medium">{fmtNumber(o.amount_fx, currency === 'JPY' ? 0 : 2)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">체결 완료</div>
                  <div className="font-medium text-emerald-600 dark:text-emerald-400">{fmtNumber(filled, currency === 'JPY' ? 0 : 2)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">잔여</div>
                  <div className="font-semibold text-orange-600 dark:text-orange-400">{fmtNumber(remaining, currency === 'JPY' ? 0 : 2)}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        현재 판정이 "조치 불필요"로 바뀌었어도, 위 지시가 전량 체결되기 전까지는 계속 표시됩니다.
      </p>
    </div>
  )
}
