import { fmtKRW } from '../../lib/format'
import type { WaterfallItem } from '../../hooks/useDashboard'

interface Props { items: WaterfallItem[] }

const SIGN_STYLE: Record<string, string> = {
  '+': 'text-emerald-600',
  '-': 'text-red-500',
  '=': 'text-blue-700 font-bold',
}

export default function WaterfallCard({ items }: Props) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="text-sm font-semibold text-gray-600 mb-4">자금 흐름 (워터폴)</h3>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className={`flex items-center justify-between py-1.5 ${
            item.sign === '=' ? 'border-t border-gray-200 pt-3 mt-1' : ''
          }`}>
            <div className="flex items-center gap-2">
              <span className={`w-5 text-sm font-bold ${SIGN_STYLE[item.sign]}`}>
                {item.sign}
              </span>
              <span className={`text-sm ${item.sign === '=' ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                {item.label}
              </span>
            </div>
            <span className={`text-sm tabular-nums ${
              item.sign === '='
                ? item.value >= 0 ? 'font-bold text-blue-700' : 'font-bold text-red-600'
                : 'text-gray-700'
            }`}>
              {item.sign === '-' && item.value > 0 ? '-' : ''}{fmtKRW(Math.abs(item.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
