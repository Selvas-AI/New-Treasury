import { useState } from 'react'
import { useFxRegimeSnapshotHistory } from '../../hooks/useFxRegimeSnapshotHistory'
import { fmtKRW } from '../../lib/format'
import type { Company } from '../../types'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 조치 카드 이력 조회 (세션26차 7일차) — "매각 후 조치 사항이 사라져 그 당시 상황을
 * 추적할 수 없다"는 문제 해결. fx_regime_snap_*(policy_params)는 판정 때마다 덮어써
 * "지금"만 남지만, 이 카드는 값이 바뀔 때마다 쌓인 이력(fx_regime_snapshot_history)에서
 * 선택한 날짜 이하 가장 최근 스냅샷을 찾아 보여준다.
 *
 * ⚠ 이 테이블 도입(세션26차 7일차) 이전 시점은 조회할 수 없다 — 과거로 소급 복원 불가.
 */
export default function RegimeHistoryCard({ company, currency }: { company: Company; currency: string }) {
  const { rows, loading, asOfDate } = useFxRegimeSnapshotHistory(company, currency)
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayStr())

  const snap = asOfDate(date)

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200">
        📜 조치 이력 조회 {open ? '접기' : '보기'}
        <span className="ml-2 text-[11px] font-normal text-gray-400 dark:text-slate-500">
          과거 특정 날짜의 조치 카드(목표비중·현재비중·권고액)를 다시 봅니다
        </span>
      </summary>
      <div className="px-4 pb-4">
        {loading ? (
          <p className="text-xs text-gray-400">이력 조회 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-400">아직 기록된 이력이 없습니다(이 기능 도입 이후부터 쌓입니다).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                조회일
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="rounded border px-2 py-1 text-xs dark:bg-slate-800" />
              </label>
            </div>

            {snap ? (
              <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[11px] text-gray-400">판정일</div>
                  <div className="text-sm font-semibold tabular-nums">{snap.snapshot_date}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">목표 / 현재 비중</div>
                  <div className="text-sm font-semibold tabular-nums">
                    {snap.target_pct != null ? `${snap.target_pct}%` : '—'} / {snap.current_pct != null ? `${snap.current_pct}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">권고 매도액</div>
                  <div className={`text-sm font-semibold ${snap.suggest_krw > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                    {snap.suggest_krw > 0 ? fmtKRW(snap.suggest_krw) : '조치 불필요'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">권고 발생일</div>
                  <div className="text-sm font-semibold tabular-nums">{snap.since_date ?? '—'}</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">{date} 이전에 기록된 이력이 없습니다.</p>
            )}

            <div className="mt-3">
              <div className="text-[11px] text-gray-400 mb-1">최근 기록 (클릭하면 해당일로 조회)</div>
              <div className="flex flex-wrap gap-1.5">
                {rows.slice(0, 12).map(r => (
                  <button key={r.id} onClick={() => setDate(r.snapshot_date)}
                    className={`rounded px-2 py-1 text-[11px] ${date === r.snapshot_date
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {r.snapshot_date} {r.suggest_krw > 0 ? '🔴' : '⚪'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
