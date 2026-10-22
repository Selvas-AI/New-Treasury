import { fmtKRW } from '../../lib/format'
import { CROSSCHECK_TOLERANCE_KRW, type BalanceCrossCheck, type FundBalance } from '../../lib/balanceSheet'

/**
 * 잔액 교차검증 줄 — 같은 기말을 세 경로로 계산해 어긋나는지 보여준다.
 *
 * ⭐ 왜 필요한가 (2026-10-22)
 *   통합 상황판 888.6억 / 자금일보 908.6억 / 자금흐름 분석 962.5억 — 세 화면이 달랐는데
 *   **틀렸다는 사실을 화면이 알려주지 못해** 팀장이 육안으로 발견했다.
 *   이제 1만원이라도 벌어지면 여기서 먼저 빨갛게 뜬다.
 *
 * ⚠ 일치할 때도 접힌 한 줄로 남긴다 — "검증되고 있다"는 사실 자체가 신뢰의 근거다.
 *   다만 평상시 시선을 뺏지 않도록 초록 한 줄로만 둔다.
 */
function Row({ label, hint, bal, baseTotal }: {
  label: string; hint: string; bal: FundBalance; baseTotal: number
}) {
  const diff = bal.totalKrw - baseTotal
  const off  = Math.abs(diff) > CROSSCHECK_TOLERANCE_KRW
  return (
    <tr className="border-t border-gray-100 dark:border-slate-800">
      <td className="py-1 pr-3 whitespace-nowrap text-gray-600 dark:text-slate-300">{label}</td>
      <td className="py-1 pr-3 text-right tabular-nums font-medium">{fmtKRW(bal.availableKrw)}</td>
      <td className="py-1 pr-3 text-right tabular-nums text-gray-500 dark:text-slate-400">{fmtKRW(bal.lockedKrw)}</td>
      <td className="py-1 pr-3 text-right tabular-nums font-semibold">{fmtKRW(bal.totalKrw)}</td>
      <td className={`py-1 pr-3 text-right tabular-nums ${off ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-slate-600'}`}>
        {off ? `${diff > 0 ? '+' : '−'}${fmtKRW(Math.abs(diff))}` : '일치'}
      </td>
      <td className="py-1 text-gray-400">{hint}</td>
    </tr>
  )
}

export default function BalanceCrossCheckBar({ check, date }: {
  check: BalanceCrossCheck | null
  date: string
}) {
  if (!check) return null
  const { analysis, pointInTime, activeNow, mismatch } = check
  const base = analysis.totalKrw

  // 국채 묶음이 늘어나는 것은 중복 집계의 전조다 — 금액이 맞아도 짚어준다.
  const bondGroupDrift = activeNow && activeNow.bondGroupCount !== analysis.bondGroupCount

  return (
    <details open={mismatch}
      className={`rounded-lg border px-3 py-2 text-xs ${
        mismatch
          ? 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
          : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'}`}>
      <summary className="cursor-pointer select-none font-semibold text-gray-700 dark:text-slate-200">
        {mismatch
          ? <span className="text-red-700 dark:text-red-300">⚠ 잔액 교차검증 실패 — 경로마다 최대 {fmtKRW(check.maxDiffKrw)} 차이</span>
          : <span className="text-emerald-700 dark:text-emerald-300">✓ 잔액 교차검증 통과 — 세 경로가 같은 값</span>}
        <span className="ml-2 font-normal text-gray-400">{date} 기준 · 펼쳐서 상세 보기</span>
      </summary>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] text-gray-400 dark:text-slate-500">
              <th className="py-1 pr-3 text-left font-normal">계산 경로</th>
              <th className="py-1 pr-3 text-right font-normal">가용</th>
              <th className="py-1 pr-3 text-right font-normal">묶인 돈</th>
              <th className="py-1 pr-3 text-right font-normal">총액</th>
              <th className="py-1 pr-3 text-right font-normal">기준 대비</th>
              <th className="py-1 text-left font-normal">같은 값을 쓰는 화면</th>
            </tr>
          </thead>
          <tbody>
            <Row label="이 화면 (과거 재구성)" hint="자금흐름 분석" bal={analysis} baseTotal={base} />
            <Row label="종료일 기준" hint="자금일보 자금 총합계" bal={pointInTime} baseTotal={base} />
            {activeNow && <Row label="현재 보유 기준" hint="통합 상황판 가용자금" bal={activeNow} baseTotal={base} />}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-gray-400">
          셋은 <b>같은 산식</b>(balanceSheet)을 쓰고 보유 판정만 다릅니다 — 차이가 나면 데이터나 복원 경로에 문제가 있다는 뜻입니다.
          {!activeNow && ' · 기말이 최신 입력일이 아니라 «현재 보유 기준»은 비교에서 제외했습니다.'}
        </p>
        {bondGroupDrift && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ 국채 묶음 수가 다릅니다(이 화면 {analysis.bondGroupCount} · 현재 {activeNow?.bondGroupCount}) — 같은 종목이 두 번 세어질 수 있습니다.
          </p>
        )}
      </div>
    </details>
  )
}
