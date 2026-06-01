import { fmtKRW } from '../../lib/format'

interface Props {
  label: string
  value: number
  sub?: string
  color?: 'blue' | 'green' | 'red' | 'gray' | 'purple'
}

const COLOR: Record<string, string> = {
  blue:   'bg-blue-50 border-blue-200 text-blue-700',
  green:  'bg-emerald-50 border-emerald-200 text-emerald-700',
  red:    'bg-red-50 border-red-200 text-red-700',
  gray:   'bg-gray-50 border-gray-200 text-gray-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
}

export default function KpiCard({ label, value, sub, color = 'gray' }: Props) {
  return (
    <div className={`rounded-xl border p-4 ${COLOR[color]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold">{fmtKRW(value)}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  )
}
