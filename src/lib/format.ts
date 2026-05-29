// 원화 억/만 단위 포맷
export function fmtKRW(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '0원'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100_000_000) return sign + (abs / 100_000_000).toFixed(1) + '억원'
  if (abs >= 10_000) return sign + (abs / 10_000).toFixed(0) + '만원'
  return sign + abs.toLocaleString() + '원'
}

// YYYYMMDD → YYYY-MM-DD 정규화
export function normDate(d: string | null | undefined): string {
  if (!d) return ''
  const s = String(d).trim()
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  return s
}

// 수익률 계산
export function calcReturn(evalAmt: number, acqCost: number): number | null {
  if (!acqCost || acqCost <= 0 || !evalAmt) return null
  return ((evalAmt - acqCost) / acqCost) * 100
}

// 오늘 영업일 여부 (주말 제외, 공휴일 미포함)
export function isBusinessDay(date: Date = new Date()): boolean {
  const day = date.getDay()
  return day !== 0 && day !== 6
}