/**
 * 일자별 증감 원장 (2026-09-08)
 *
 * ⭐ 잔액의 정본은 **자금 변동 이력과 같은 총액**이다(운전 + 운용 전체).
 *   분석 대상을 좁혀 놓고 잔액까지 좁히면 다른 화면과 숫자가 갈라져 아무도 믿지 못한다.
 *   총액으로 시계열을 만들고, 그 증감을 아래 셋으로 **설명(검증)** 한다:
 *     · 운전자금 변동   — 자금일보 항목이 있으면 그 건수를 함께 보여준다
 *     · 운용 개시·해지  — 운용자금 레코드에서 직접 뽑는다(일보를 안 거쳐도 잡힌다)
 *     · 국채 평가       — 시가 변동이라 현금이 움직인 게 아니다. 반드시 구분한다.
 *
 * ⚠ 8월에 해지한 예금도 6월에는 존재했다 — 과거 잔액에 포함된다(isOpenOn 판정).
 */
import { useState } from 'react'
import { fmtKRW } from '../../lib/format'
import type { DailyLedgerRow } from '../../lib/flowBridge'

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmtKRW(Math.abs(n))}`
const toneOf = (n: number) =>
  n > 0 ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'

export default function DailyLedgerView({ ledger }: { ledger: DailyLedgerRow[] }) {
  const [openDate, setOpenDate] = useState<string | null>(null)
  const shown = [...ledger].reverse()   // 최신 먼저

  const sum = ledger.reduce((a, r) => ({
    all:  a.all  + r.allDelta,
    op:   a.op   + r.opDelta,
    inv:  a.inv  + r.investDelta,
    bond: a.bond + r.bondDelta,
    lock: a.lock + r.lockedDelta,
  }), { all: 0, op: 0, inv: 0, bond: 0, lock: 0 })

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <p className="text-[11px] text-gray-500 dark:text-slate-400">
          잔액은 <strong>자금 변동 이력과 같은 총액</strong>(운전 + 운용 전체, 국채·불가용 포함)입니다.
          그 증감을 운전자금 변동 · 운용 개시/해지 · 국채 평가로 나눠 설명합니다.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
          <span>기간 합계 <strong className={toneOf(sum.all)}>{signed(sum.all)}</strong></span>
          <span className="text-gray-500 dark:text-slate-400">운전 {signed(sum.op)}</span>
          <span className="text-gray-500 dark:text-slate-400">가용운용 {signed(sum.inv)}</span>
          <span className="text-gray-500 dark:text-slate-400">국채 {signed(sum.bond)}</span>
          {sum.lock !== 0 && <span className="text-gray-500 dark:text-slate-400">불가용 {signed(sum.lock)}</span>}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-300">
              <th className="text-left  px-3 py-2.5 whitespace-nowrap">일자</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">총액</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">총 증감</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap border-l border-gray-200 dark:border-slate-600">운전</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">가용운용</th>
              <th className="text-right px-3 py-2.5 whitespace-nowrap">국채</th>
              <th className="text-left  px-3 py-2.5">설명</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <LedgerRow key={r.date} row={r}
                open={openDate === r.date}
                onToggle={() => setOpenDate(openDate === r.date ? null : r.date)} />
            ))}
            {!shown.length && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                이 기간에 잔액 데이터가 없습니다.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LedgerRow({ row: r, open, onToggle }: {
  row: DailyLedgerRow; open: boolean; onToggle: () => void
}) {
  const quiet = r.allDelta === 0
  return (
    <>
      <tr
        className="border-t border-gray-100 dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40"
        onClick={onToggle}
      >
        <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-slate-300 whitespace-nowrap">
          <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>{r.date}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100">
          {fmtKRW(r.allTotal)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${quiet ? 'text-gray-400' : toneOf(r.allDelta)}`}>
          {quiet ? '—' : signed(r.allDelta)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums border-l border-gray-100 dark:border-slate-700 ${toneOf(r.opDelta)}`}>
          {r.opDelta === 0 ? '—' : signed(r.opDelta)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${toneOf(r.investDelta)}`}>
          {r.investDelta === 0 ? '—' : signed(r.investDelta)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${toneOf(r.bondDelta)}`}>
          {r.bondDelta === 0 ? '—' : signed(r.bondDelta)}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
          {r.opened.length > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 mr-2">개시 {r.opened.length}건</span>
          )}
          {r.closed.length > 0 && (
            <span className="text-red-600 dark:text-red-400 mr-2">해지 {r.closed.length}건</span>
          )}
          {r.bondDelta !== 0 && <span className="text-gray-400 mr-2">국채 평가</span>}
          {r.lockedDelta !== 0 && (
            <span className="text-amber-600 dark:text-amber-400 mr-2">불가용 {signed(r.lockedDelta)}</span>
          )}
          {r.investAdjust !== 0 && (
            <span className="text-amber-600 dark:text-amber-400 mr-2"
              title="개시·해지로 설명되지 않는 가용운용 증감 — 금액 수정·가용 여부 변경 등">
              조정 {signed(r.investAdjust)}
            </span>
          )}
          {r.itemCount > 0 && <span className="text-gray-400">일보 {r.itemCount}건</span>}
          {r.itemCount === 0 && r.opDelta !== 0 && (
            <span className="text-gray-400">일보 항목 없음</span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="bg-gray-50 dark:bg-slate-900/40">
          <td colSpan={7} className="px-8 py-3">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* 구성 — 이 날 총액이 무엇으로 이뤄져 있나 */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1">잔액 구성</p>
                <table className="text-xs w-full tabular-nums">
                  <tbody className="text-gray-600 dark:text-slate-300">
                    <tr><td className="py-0.5">운전자금</td>
                      <td className="py-0.5 text-right">{fmtKRW(r.opCash)}</td></tr>
                    <tr><td className="py-0.5">가용 운용자금</td>
                      <td className="py-0.5 text-right">{fmtKRW(r.breakdown.availKrw)}</td></tr>
                    <tr><td className="py-0.5">국채</td>
                      <td className="py-0.5 text-right">{fmtKRW(r.breakdown.bondKrw)}</td></tr>
                    <tr><td className="py-0.5">불가용 운용자금</td>
                      <td className="py-0.5 text-right">{fmtKRW(r.breakdown.lockedKrw)}</td></tr>
                    <tr className="border-t border-gray-200 dark:border-slate-600 font-semibold">
                      <td className="py-1">총액</td>
                      <td className="py-1 text-right">{fmtKRW(r.allTotal)}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* 검증 — 이 날 증감이 무엇으로 설명되나 */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 mb-1">증감 설명</p>
                {r.opened.length + r.closed.length === 0 && r.bondDelta === 0 && r.itemCount === 0 ? (
                  <p className="text-xs text-gray-400">
                    운용자금 개시·해지 기록도, 자금일보 항목도 없습니다 — 운전자금 잔액 입력만 바뀌었습니다.
                  </p>
                ) : (
                  <table className="text-xs w-full tabular-nums">
                    <tbody className="text-gray-600 dark:text-slate-300">
                      {[...r.opened, ...r.closed].map(d => (
                        <tr key={d.kind + d.id}>
                          <td className="py-0.5 w-12">
                            <span className={d.kind === 'opened'
                              ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                              {d.kind === 'opened' ? '개시' : '해지'}
                            </span>
                          </td>
                          <td className="py-0.5">{d.label}</td>
                          <td className="py-0.5 text-right">
                            {d.kind === 'opened' ? '+' : '−'}{fmtKRW(d.amountKrw)}
                          </td>
                        </tr>
                      ))}
                      {r.bondDelta !== 0 && (
                        <tr>
                          <td className="py-0.5 text-gray-400">평가</td>
                          <td className="py-0.5">국채 기준가 변동</td>
                          <td className={`py-0.5 text-right ${toneOf(r.bondDelta)}`}>{signed(r.bondDelta)}</td>
                        </tr>
                      )}
                      {r.itemCount > 0 && (
                        <tr>
                          <td className="py-0.5 text-gray-400">일보</td>
                          <td className="py-0.5">입출금 항목 {r.itemCount}건</td>
                          <td className={`py-0.5 text-right ${toneOf(r.itemNetKrw)}`}>{signed(r.itemNetKrw)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
