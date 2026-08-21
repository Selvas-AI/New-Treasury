import { useMemo, useState } from 'react'
import { useFxRegimeSnapshotHistory, type RegimeSnapshotHistoryRow } from '../../hooks/useFxRegimeSnapshotHistory'
import { fmtKRW } from '../../lib/format'
import type { Company } from '../../types'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * 조치 카드 이력 조회 (세션26차 7일차) — "매각 후 조치 사항이 사라져 그 당시 상황을
 * 추적할 수 없다"는 문제 해결. fx_regime_snap_*(policy_params)는 판정 때마다 덮어써
 * "지금"만 남지만, 이 카드는 값이 바뀔 때마다 쌓인 이력(fx_regime_snapshot_history)을
 * 판정일 단위로 묶어 보여준다.
 *
 * ⚠ 판정 입력(환율·보유액·정책값)이 하루에 여러 번 바뀌면 같은 날짜에 기록이 여러 건
 *   쌓인다. 과거엔 날짜 칩을 그 건수만큼 나열해 "같은 날짜가 왜 여러 개냐"는 혼선이
 *   있었고, 조회는 그날 **마지막 기록**만 보여줘 중간에 떴다 사라진 권고(🔴)를 확인할
 *   방법이 없었다. → 날짜 1줄로 접고, 클릭하면 그날 전체 흐름을 시각순으로 펼친다.
 *
 * ⚠ 이 테이블 도입(세션26차 7일차) 이전 시점은 조회할 수 없다 — 과거로 소급 복원 불가.
 */
export default function RegimeHistoryCard({ company, currency }: { company: Company; currency: string }) {
  const { rows, loading } = useFxRegimeSnapshotHistory(company, currency)
  const [open, setOpen] = useState(false)
  const [openDate, setOpenDate] = useState<string | null>(null)

  /** 판정일 단위 그룹 — rows 는 snapshot_date.desc, captured_at.desc 정렬 상태 */
  const groups = useMemo(() => {
    const map = new Map<string, RegimeSnapshotHistoryRow[]>()
    for (const r of rows) {
      const list = map.get(r.snapshot_date)
      if (list) list.push(r)
      else map.set(r.snapshot_date, [r])
    }
    return [...map.entries()].map(([date, list]) => ({
      date,
      list,
      /** 그날 마지막(=가장 최근) 기록 — 접힌 줄의 요약 */
      last: list[0],
      hadSuggest: list.some(r => r.suggest_krw > 0),
    }))
  }, [rows])

  /** 조회일 점프 — 그 날짜 이하 가장 최근 판정일 그룹을 연다 */
  function jumpTo(date: string) {
    const hit = groups.find(g => g.date <= date)
    setOpenDate(hit?.date ?? null)
  }

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200">
        📜 조치 이력 조회 {open ? '접기' : '보기'}
        <span className="ml-2 text-[11px] font-normal text-gray-400 dark:text-slate-500">
          판정일을 클릭하면 그날의 조치 카드(목표비중·현재비중·권고액) 변화를 봅니다
        </span>
      </summary>
      <div className="px-4 pb-4">
        {loading ? (
          <p className="text-xs text-gray-400">이력 조회 중…</p>
        ) : groups.length === 0 ? (
          <p className="text-xs text-gray-400">아직 기록된 이력이 없습니다(이 기능 도입 이후부터 쌓입니다).</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                조회일로 이동
                <input type="date" defaultValue={todayStr()} onChange={e => jumpTo(e.target.value)}
                  className="rounded border px-2 py-1 text-xs dark:bg-slate-800" />
              </label>
              <span className="text-[11px] text-gray-400">그 날짜 이하 가장 최근 판정일을 엽니다</span>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
              {groups.slice(0, 30).map(g => {
                const expanded = openDate === g.date
                return (
                  <div key={g.date}>
                    <button
                      onClick={() => setOpenDate(expanded ? null : g.date)}
                      className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-slate-800 ${
                        expanded ? 'bg-blue-50 dark:bg-slate-800' : ''}`}>
                      <span className="w-3 text-gray-400">{expanded ? '▾' : '▸'}</span>
                      <span className="font-semibold tabular-nums text-gray-800 dark:text-slate-100">{g.date}</span>
                      <span className="text-gray-400">기록 {g.list.length}건</span>
                      {g.hadSuggest && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          🔴 이날 권고 발생
                        </span>
                      )}
                      <span className="ml-auto tabular-nums text-gray-500 dark:text-slate-400">
                        목표 {g.last.target_pct != null ? `${g.last.target_pct}%` : '—'} / 현재 {g.last.current_pct != null ? `${g.last.current_pct}%` : '—'}
                      </span>
                      <span className={`tabular-nums font-semibold ${g.last.suggest_krw > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                        {g.last.suggest_krw > 0 ? fmtKRW(g.last.suggest_krw) : '조치 불필요'}
                      </span>
                    </button>

                    {expanded && (
                      <div className="px-3 pb-3 pt-1">
                        <p className="mb-1.5 text-[11px] text-gray-400">
                          기록 시각 순(최신 → 과거). 판정 입력(환율·보유액·정책값)이 바뀔 때마다 한 줄씩 쌓입니다.
                          맨 윗줄이 이 날짜의 최종 상태입니다.
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100 text-[11px] text-gray-400 dark:border-slate-800 dark:text-slate-500">
                                <th className="py-1 pr-3 text-left font-normal">기록 시각</th>
                                <th className="py-1 pr-3 text-right font-normal">목표 비중</th>
                                <th className="py-1 pr-3 text-right font-normal">현재 비중</th>
                                <th className="py-1 pr-3 text-right font-normal">권고 매도액</th>
                                <th className="py-1 pr-3 text-left font-normal">권고 발생일</th>
                                <th className="py-1 text-left font-normal">기록자</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.list.map(r => (
                                <tr key={r.id} className="border-b border-gray-50 last:border-0 dark:border-slate-800/60">
                                  <td className="py-1.5 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{fmtTime(r.captured_at)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.target_pct != null ? `${r.target_pct}%` : '—'}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.current_pct != null ? `${r.current_pct}%` : '—'}</td>
                                  <td className={`py-1.5 pr-3 text-right font-semibold tabular-nums ${
                                    r.suggest_krw > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                                    {r.suggest_krw > 0 ? fmtKRW(r.suggest_krw) : '조치 불필요'}
                                  </td>
                                  <td className="py-1.5 pr-3 tabular-nums text-gray-500 dark:text-slate-400">{r.since_date ?? '—'}</td>
                                  <td className="py-1.5 text-gray-400">{r.captured_by ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </details>
  )
}
