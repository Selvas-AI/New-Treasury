import { fmtKRW } from '../../lib/format'

interface Props {
  label: string
  value: number
  sub?: string
  color?: 'blue' | 'green' | 'red' | 'gray' | 'purple'
  /** 연관 차트/카드 이름 — 우하단 정적 배지로 표시 */
  linkedChart?: string
  onClick?: () => void
}

const COLOR: Record<string, string> = {
  blue:   'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300',
  green:  'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300',
  red:    'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300',
  gray:   'bg-gray-50 border-gray-200 text-gray-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100',
  purple: 'bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-950/40 dark:border-purple-800 dark:text-purple-300',
}

const BADGE_COLOR: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-500 dark:bg-blue-900/50 dark:text-blue-400',
  green:  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400',
  red:    'bg-red-100 text-red-500 dark:bg-red-900/50 dark:text-red-400',
  gray:   'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300',
  purple: 'bg-purple-100 text-purple-500 dark:bg-purple-900/50 dark:text-purple-400',
}

export default function KpiCard({ label, value, sub, color = 'gray', linkedChart, onClick }: Props) {
  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-1 ${COLOR[color]} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold">{fmtKRW(value)}</p>
      {sub && <p className="text-xs opacity-60">{sub}</p>}
      {linkedChart && (
        <div className="flex justify-end mt-1">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${BADGE_COLOR[color]}`}>
            ⎆ {linkedChart}
          </span>
        </div>
      )}
    </div>
  )
}

