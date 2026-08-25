/**
 * CloseDateModal — 만기처리(운용자금) / 상환처리(차입금) 확인 + 실제 해지일 입력
 *
 * 왜 날짜를 받는가:
 *   closed_date 는 자금일보 자금현황이 기초·마감 잔액을 가르는 기준이다.
 *   어제 해지된 건을 오늘 처리하면서 closed_date 를 오늘로 박으면, 어제를 보고대상일로
 *   하는 일보에서는 그 자금이 아직 살아 있는 것으로 잡혀 출금이 소명되지 않는다.
 *
 * 왜 window.confirm 이 아닌가:
 *   크롬은 같은 페이지에서 대화상자가 반복되면 차단하고, 그때 confirm() 은 즉시 false 를
 *   반환한다 → 버튼을 눌러도 아무 일이 없는 것처럼 보인다(세션24차 실사고).
 */
interface Props {
  title:      string
  recordLabel: string
  /** true면 날짜 입력 없이 확인만 (복원 등) */
  dateless?:  boolean
  date:       string
  onDateChange: (v: string) => void
  confirmLabel: string
  busy?:      boolean
  onConfirm:  () => void
  onCancel:   () => void
}

export default function CloseDateModal({
  title, recordLabel, dateless, date, onDateChange, confirmLabel, busy, onConfirm, onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xl p-5 space-y-4"
        style={{ animation: 'fadeInScale 0.18s ease-out both' }}
      >
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">{title}</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400 break-keep">{recordLabel}</p>
        </div>

        {!dateless && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300">
              실제 해지·상환일
            </label>
            <input
              type="date"
              value={date}
              onChange={e => onDateChange(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500 break-keep">
              이 날짜를 기준으로 자금일보 자금현황의 출금액·마감잔액이 갈립니다.
              어제 해지된 건이면 어제 날짜로 지정하세요.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-xs rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
          >취소</button>
          <button
            onClick={onConfirm}
            disabled={busy || (!dateless && !date)}
            className="flex-1 py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >{busy ? '처리 중…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
