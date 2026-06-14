/**
 * bizDay.ts — 한국 영업일 유틸
 *
 * 공휴일 범위: 2025~2028 하드코딩 (fallback)
 * GAS ?type=holidays&year=YYYY 로 자동 보완 가능 (initHolidays 호출 시)
 * localStorage 키: treasury_holidays_{YEAR}
 */

// ── 하드코딩 공휴일 (YYYY-MM-DD) — GAS 미응답 시 fallback ────────
const HARDCODED: readonly string[] = [
  // 2025
  '2025-01-01', // 신정
  '2025-01-28', // 설날 전날
  '2025-01-29', // 설날
  '2025-01-30', // 설날 다음날
  '2025-03-01', // 삼일절 (토)
  '2025-03-03', // 삼일절 대체공휴일
  '2025-05-05', // 어린이날
  '2025-05-06', // 부처님오신날 (어린이날 대체)
  '2025-06-06', // 현충일
  '2025-08-15', // 광복절
  '2025-10-03', // 개천절
  '2025-10-05', // 추석 전날 (일)
  '2025-10-06', // 추석
  '2025-10-07', // 추석 다음날
  '2025-10-08', // 추석 대체공휴일
  '2025-10-09', // 한글날
  '2025-12-25', // 크리스마스

  // 2026
  '2026-01-01', // 신정
  '2026-01-27', // 설날 전날
  '2026-01-28', // 설날
  '2026-01-29', // 설날 다음날
  '2026-03-01', // 삼일절 (일)
  '2026-03-02', // 삼일절 대체공휴일
  '2026-05-05', // 어린이날
  '2026-05-24', // 부처님오신날
  '2026-05-25', // 부처님오신날 대체 (일요일)
  '2026-06-06', // 현충일 (토)
  '2026-06-08', // 현충일 대체공휴일
  '2026-08-15', // 광복절 (토)
  '2026-08-17', // 광복절 대체공휴일
  '2026-09-24', // 추석 전날
  '2026-09-25', // 추석
  '2026-09-26', // 추석 다음날 (토)
  '2026-09-28', // 추석 대체공휴일
  '2026-10-03', // 개천절 (토)
  '2026-10-05', // 개천절 대체공휴일
  '2026-10-09', // 한글날
  '2026-12-25', // 크리스마스

  // 2027
  '2027-01-01', // 신정
  '2027-02-16', // 설날 전날
  '2027-02-17', // 설날
  '2027-02-18', // 설날 다음날
  '2027-03-01', // 삼일절 (월)
  '2027-05-05', // 어린이날
  '2027-05-13', // 부처님오신날 (음력 4/8)
  '2027-06-06', // 현충일 (일)
  '2027-06-07', // 현충일 대체공휴일
  '2027-08-15', // 광복절 (일)
  '2027-08-16', // 광복절 대체공휴일
  '2027-09-21', // 추석 전날
  '2027-09-22', // 추석
  '2027-09-23', // 추석 다음날
  '2027-10-03', // 개천절 (일)
  '2027-10-04', // 개천절 대체공휴일
  '2027-10-09', // 한글날 (토)
  '2027-10-11', // 한글날 대체공휴일
  '2027-12-25', // 크리스마스 (토)
  '2027-12-27', // 크리스마스 대체공휴일

  // 2028
  '2028-01-01', // 신정 (토)
  '2028-01-03', // 신정 대체공휴일
  '2028-02-04', // 설날 전날
  '2028-02-05', // 설날 (토)
  '2028-02-06', // 설날 다음날 (일)
  '2028-02-07', // 설날 대체공휴일
  '2028-03-01', // 삼일절 (수)
  '2028-05-02', // 부처님오신날 (음력 4/8)
  '2028-05-05', // 어린이날 (금)
  '2028-06-06', // 현충일 (수)
  '2028-08-15', // 광복절 (화)
  '2028-09-11', // 추석 전날
  '2028-09-12', // 추석 (화)
  '2028-09-13', // 추석 다음날
  '2028-10-03', // 개천절 (화)
  '2028-10-09', // 한글날 (월)
  '2028-12-25', // 크리스마스 (월)
]

// ── 런타임 공휴일 Set (하드코딩 + localStorage 캐시 병합) ──────────
let HOLIDAYS = new Set<string>(HARDCODED)

const LS_PREFIX = 'treasury_holidays_'

/** localStorage에 캐시된 공휴일 연도 목록을 HOLIDAYS에 병합 */
function loadCached(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(LS_PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const dates: string[] = JSON.parse(raw)
      dates.forEach(d => HOLIDAYS.add(d))
    }
  } catch { /* localStorage 없는 환경(SSR 등) 무시 */ }
}

loadCached()

/** GAS에서 특정 연도 공휴일을 가져와 캐시 (앱 시작 시 1회 호출 권장) */
export async function fetchAndCacheHolidays(year: number): Promise<void> {
  const lsKey = LS_PREFIX + year
  try {
    if (localStorage.getItem(lsKey)) return  // 이미 캐시됨
  } catch { /* no-op */ }

  const gasUrl = import.meta.env.VITE_GAS_API_URL
  if (!gasUrl) return

  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 15_000)
    const res = await fetch(`${gasUrl}?type=holidays&year=${year}`, { signal: ctrl.signal })
    window.clearTimeout(timer)
    if (!res.ok) return
    const json = await res.json() as { success: boolean; dates?: string[] }
    if (!json.success || !json.dates?.length) return
    json.dates.forEach(d => HOLIDAYS.add(d))
    try { localStorage.setItem(lsKey, JSON.stringify(json.dates)) } catch { /* no-op */ }
  } catch { /* 네트워크 오류 — 하드코딩 fallback 유지 */ }
}

// ── 핵심 유틸 ────────────────────────────────────────────────────────

/** 해당 날짜가 영업일인지 (주말·공휴일 제외) */
export function isBusinessDay(date: string): boolean {
  const d   = new Date(date + 'T00:00:00')
  const dow = d.getDay()  // 0=일, 6=토
  if (dow === 0 || dow === 6) return false
  return !HOLIDAYS.has(date)
}

/** 오늘이 영업일인지 */
export function isTodayBusinessDay(): boolean {
  return isBusinessDay(todayStr())
}

/** 직전 영업일 (주말+공휴일 건너뜀) */
export function prevBizDay(date: string): string {
  const d = new Date(date + 'T00:00:00')
  do {
    d.setDate(d.getDate() - 1)
  } while (!isBusinessDay(toLocal(d)))
  return toLocal(d)
}

/** 해당 날짜 또는 가장 가까운 이전 영업일로 snap */
export function snapToBizDay(date: string): string {
  const d = new Date(date + 'T00:00:00')
  while (!isBusinessDay(toLocal(d))) {
    d.setDate(d.getDate() - 1)
  }
  return toLocal(d)
}

/** 다음 영업일 */
export function nextBizDay(date: string, max?: string): string {
  const d = new Date(date + 'T00:00:00')
  do {
    d.setDate(d.getDate() + 1)
  } while (!isBusinessDay(toLocal(d)))
  const result = toLocal(d)
  if (max && result > max) return max
  return result
}

/** 오늘 날짜 YYYY-MM-DD (로컬) */
export function todayStr(): string {
  return toLocal(new Date())
}

function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}
