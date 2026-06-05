// ─── 숫자/날짜 포맷 ──────────────────────────────────────

/** 원화 억/만 단위 포맷 */
export function fmtKRW(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '0원'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100_000_000) return sign + (abs / 100_000_000).toFixed(1) + '억원'
  if (abs >= 10_000) return sign + (abs / 10_000).toFixed(0) + '만원'
  return sign + abs.toLocaleString() + '원'
}

/** 숫자 3자리 콤마 포맷 */
export function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
}

/** YYYYMMDD → YYYY-MM-DD 정규화 */
export function normDate(d: string | null | undefined): string {
  if (!d) return ''
  const s = String(d).trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s
}

/** YYYY-MM-DD → M월 D일 표시 */
export function fmtDateShort(d: string): string {
  if (!d) return ''
  const [, m, day] = d.split('-')
  return `${Number(m)}월 ${Number(day)}일`
}

/** 만기까지 D-day 계산 (오늘 기준) */
export function calcDday(maturity: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const mat = new Date(maturity)
  mat.setHours(0, 0, 0, 0)
  return Math.round((mat.getTime() - today.getTime()) / 86_400_000)
}

// ─── 수익률 ──────────────────────────────────────────────

/** 수익률(%) 계산 */
export function calcReturn(evalAmt: number, acqCost: number): number | null {
  if (!acqCost || acqCost <= 0 || !evalAmt) return null
  return ((evalAmt - acqCost) / acqCost) * 100
}

/** 수익률 배지 스타일 — 호가창 스타일 (상승=빨강, 하락=파랑) */
export function returnBadgeClass(ret: number | null): string {
  if (ret === null) return 'bg-gray-100 text-gray-500'
  if (ret > 0) return 'bg-red-50 text-red-600'
  if (ret < 0) return 'bg-blue-50 text-blue-600'
  return 'bg-gray-100 text-gray-500'
}

/** 수익률 텍스트 (+2.3% / -1.5% / 0.0%) */
export function fmtReturn(ret: number | null): string {
  if (ret === null) return '-'
  return (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%'
}

// ─── 영업일 ──────────────────────────────────────────────

const KR_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30',
  '2026-03-01', '2026-03-02', '2026-05-05', '2026-06-06',
  '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
])

/** 오늘 영업일 여부 (주말 + 2026 공휴일 제외) */
export function isBusinessDay(date: Date = new Date()): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  const iso = date.toISOString().slice(0, 10)
  return !KR_HOLIDAYS_2026.has(iso)
}

// ─── 이슈 키 ─────────────────────────────────────────────

/** 이슈 식별자 생성 — D-day 없이 안정화된 키 */
export function makeIssueKey(type: 'loan' | 'equity' | 'input_daily', id?: string): string {
  if (type === 'input_daily') return 'input_daily'
  return `${type}_${id ?? ''}`
}

// ─── 국채 평가금액 ────────────────────────────────────────

/** 국채 평가금액 = 좌수 × (기준가 ÷ 10) */
export function calcBondValue(qty: number, price: number): number {
  return qty * (price / 10)
}
