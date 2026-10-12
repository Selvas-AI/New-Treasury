import { useFx } from '../../hooks/useFx'

/**
 * 환율 상태 안내 — 외화 환산이 최신이 아니거나 불가능할 때만 보인다.
 *
 * 배경(2026-10-12 실사용 리포트): 환율 조회가 끊기면 toKRW 가 0 을 돌려줘
 * **자금일보·대시보드 합계에서 외화가 통째로 빠진 채** 아무 표시 없이 나왔다.
 * 지금은 마지막 성공 환율을 보관해 환산을 유지하지만, 그 사실을 숨기면
 * "최신 환율로 계산된 값"으로 오해한다 → 기준 시각을 명시한다.
 *
 * ⚠ 정상일 때는 아무것도 렌더하지 않는다(상시 배너는 곧 무시당한다).
 */
export default function FxRateNotice({ className = '' }: { className?: string }) {
  const { stale, unavailable, ratesAt, fetchRates, loading } = useFx()
  if (!stale && !unavailable) return null

  const at = ratesAt
    ? new Date(ratesAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  const danger = unavailable
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
      danger
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
    } ${className}`}>
      <span className="font-semibold">{danger ? '⚠ 환율 조회 실패 — 외화 미반영' : '⏱ 최신 환율 아님'}</span>
      <span>
        {danger
          ? '외화 잔액이 원화 환산되지 않아 합계에서 빠져 있습니다. 이 화면의 총액을 그대로 신뢰하지 마세요.'
          : `마지막으로 받은 ${at} 기준 환율로 환산 중입니다.`}
      </span>
      <button type="button" onClick={() => void fetchRates()} disabled={loading}
        className="ml-auto rounded border border-current px-2 py-0.5 font-medium disabled:opacity-50">
        {loading ? '조회 중…' : '환율 다시 조회'}
      </button>
    </div>
  )
}
