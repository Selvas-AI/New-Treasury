/**
 * bizDay.ts — 한국 영업일 유틸
 *
 * 공휴일 범위: 2025~2028 하드코딩 (fallback)
 * GAS ?type=holidays&year=YYYY 로 자동 보완 가능 (initHolidays 호출 시)
 * localStorage 키: treasury_holidays_{YEAR}
 */

// ── 하드코딩 공휴일 (YYYY-MM-DD) — GAS 미응답 시 fallback ────────
const HARDCODED: readonly string[] = [
  // ⚠ 대체공휴일은 공휴일마다 규칙이 다르다. 임의로 "주말과 겹치면 월요일" 을 적용하지 말 것.
  //   · 삼일절·어린이날·부처님오신날·광복절·개천절·한글날·성탄절 → 토·일 겹치면 대체
  //   · 설날·추석 연휴 → **일요일(또는 다른 공휴일)** 과 겹칠 때만 대체. **토요일은 대상 아님**
  //   · 신정(1/1)·현충일 → 대체공휴일 **없음**
  // ⚠ 설날·추석은 음력이라 해마다 날짜가 크게 움직인다. 추정하지 말고 반드시 확인할 것.
  // ⚠ 근로자의날(5/1)은 관공서 공휴일이 아니라 API 응답에 없다 → 아래 BANK_HOLIDAYS 로 분리.
  // ⚠ 선거일(공직선거법 임기만료 선거)은 관공서 공휴일이라 API 에는 포함된다.
  //   하드코딩에는 넣지 않았다 — 필요해지면 확정 공고 후 추가할 것.

  // 2025
  '2025-01-01', // 신정
  '2025-01-27', // 설 연휴 임시공휴일
  '2025-01-28', // 설날 전날
  '2025-01-29', // 설날 (수)
  '2025-01-30', // 설날 다음날
  '2025-03-01', // 삼일절 (토)
  '2025-03-03', // 삼일절 대체공휴일
  '2025-05-05', // 어린이날 = 부처님오신날 (월)
  '2025-05-06', // 어린이날·부처님오신날 중복 대체공휴일
  '2025-06-06', // 현충일 (금)
  '2025-08-15', // 광복절 (금)
  '2025-10-03', // 개천절 (금)
  '2025-10-05', // 추석 전날 (일)
  '2025-10-06', // 추석 (월)
  '2025-10-07', // 추석 다음날
  '2025-10-08', // 추석 대체공휴일 (전날이 일요일과 겹침)
  '2025-10-09', // 한글날
  '2025-12-25', // 크리스마스

  // 2026
  '2026-01-01', // 신정 (목) — 신정은 대체공휴일 없음
  '2026-02-16', // 설날 전날 (월)
  '2026-02-17', // 설날 (화)
  '2026-02-18', // 설날 다음날 (수)
  '2026-03-01', // 삼일절 (일)
  '2026-03-02', // 삼일절 대체공휴일
  '2026-05-05', // 어린이날 (화)
  '2026-05-24', // 부처님오신날 (일)
  '2026-05-25', // 부처님오신날 대체공휴일
  '2026-06-06', // 현충일 (토) — 현충일은 대체공휴일 없음 (6/8 은 영업일)
  '2026-08-15', // 광복절 (토)
  '2026-08-17', // 광복절 대체공휴일
  '2026-09-24', // 추석 전날 (목)
  '2026-09-25', // 추석 (금)
  '2026-09-26', // 추석 다음날 (토) — 토요일은 대체 대상 아님 (9/28 은 영업일)
  '2026-10-03', // 개천절 (토)
  '2026-10-05', // 개천절 대체공휴일
  '2026-10-09', // 한글날 (금)
  '2026-12-25', // 크리스마스 (금)

  // 2027
  '2027-01-01', // 신정 (금)
  '2027-02-06', // 설날 전날 (토)
  '2027-02-07', // 설날 (일)
  '2027-02-08', // 설날 다음날 (월)
  '2027-02-09', // 설날 대체공휴일 (설날이 일요일과 겹침)
  '2027-03-01', // 삼일절 (월)
  '2027-05-05', // 어린이날 (수)
  '2027-05-13', // 부처님오신날 (목)
  '2027-06-06', // 현충일 (일) — 대체공휴일 없음
  '2027-08-15', // 광복절 (일)
  '2027-08-16', // 광복절 대체공휴일
  '2027-09-14', // 추석 전날 (화)
  '2027-09-15', // 추석 (수)
  '2027-09-16', // 추석 다음날 (목)
  '2027-10-03', // 개천절 (일)
  '2027-10-04', // 개천절 대체공휴일
  '2027-10-09', // 한글날 (토)
  '2027-10-11', // 한글날 대체공휴일
  '2027-12-25', // 크리스마스 (토)
  '2027-12-27', // 크리스마스 대체공휴일

  // 2028
  '2028-01-01', // 신정 (토) — 신정은 대체공휴일 없음 (1/3 은 영업일)
  '2028-01-26', // 설날 전날 (수)
  '2028-01-27', // 설날 (목)
  '2028-01-28', // 설날 다음날 (금)
  '2028-03-01', // 삼일절 (수)
  '2028-05-02', // 부처님오신날 (화)
  '2028-05-05', // 어린이날 (금)
  '2028-06-06', // 현충일 (화)
  '2028-08-15', // 광복절 (화)
  '2028-10-02', // 추석 전날 (월)
  '2028-10-03', // 추석 (화) = 개천절 중복
  '2028-10-04', // 추석 다음날 (수)
  '2028-10-05', // 추석 대체공휴일 (추석이 개천절과 겹침)
  '2028-10-09', // 한글날 (월)
  '2028-12-25', // 크리스마스 (월)
]

// ── 은행 휴무일 (관공서 공휴일 아님) ────────────────────────────────
// ⚠ 공공데이터포털 특일정보에는 **나오지 않는다**(관공서 공휴일이 아니라 근로기준법상 휴일).
//   그래서 연도별 API 캐시로 대체되지 않도록 HARDCODED 와 분리해 **항상 병합**한다.
//   이걸 HARDCODED 에 넣으면 해당 연도 캐시가 생기는 순간 조용히 사라진다.
const BANK_HOLIDAYS: readonly string[] = [
  '2025-05-01', // 근로자의날 (목)
  '2026-05-01', // 근로자의날 (금)
  '2027-05-01', // 근로자의날 (토) — 이미 주말
  '2028-05-01', // 근로자의날 (월)
]

// ── 런타임 공휴일 Set ───────────────────────────────────────────────
// ⚠ 하드코딩과 캐시를 그냥 합집합(union)하면 **하드코딩의 오류를 API 로도 고칠 수 없다.**
//   (실사고 2026-09-29: 하드코딩에 잘못 들어간 '2026-09-28 추석 대체공휴일' 때문에
//    공공데이터포털 응답이 정상이어도 해당 날짜가 계속 비영업일로 막혔다)
//   → **연도 단위로 캐시가 정본**이다. 그 연도의 캐시가 있으면 하드코딩은 쓰지 않는다.
const HOLIDAYS = new Set<string>()

const LS_PREFIX = 'treasury_holidays_'
/** 연도 → 공공데이터포털 응답(캐시) */
const CACHED_BY_YEAR = new Map<string, string[]>()

function yearOf(date: string): string {
  return date.slice(0, 4)
}

/** HOLIDAYS 재구성 — 캐시가 있는 연도는 캐시만, 없는 연도는 하드코딩 */
function rebuildHolidays(): void {
  HOLIDAYS.clear()
  for (const d of HARDCODED) {
    if (CACHED_BY_YEAR.has(yearOf(d))) continue
    HOLIDAYS.add(d)
  }
  for (const dates of CACHED_BY_YEAR.values()) {
    dates.forEach(d => HOLIDAYS.add(d))
  }
  // 은행 휴무일은 API 응답에 없으므로 캐시 유무와 무관하게 항상 적용한다.
  for (const d of BANK_HOLIDAYS) HOLIDAYS.add(d)
}

/**
 * 캐시 레코드 — 옛 형식(순수 배열)도 그대로 읽는다.
 * ⚠ 캐시에 만료가 없으면 **연중 지정되는 임시공휴일을 영원히 못 받는다.**
 *   (2025-01-27 사례처럼 정부가 1~2주 전에 공고하는 경우가 있다)
 *   지난 연도는 더 바뀌지 않으므로 갱신하지 않는다.
 */
interface HolidayCache { fetchedAt: number; dates: string[] }

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7일

function parseCache(raw: string): HolidayCache | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (Array.isArray(v)) return v.length ? { fetchedAt: 0, dates: v as string[] } : null  // 옛 형식
    const o = v as Partial<HolidayCache>
    if (Array.isArray(o?.dates) && o.dates.length) {
      return { fetchedAt: Number(o.fetchedAt) || 0, dates: o.dates }
    }
  } catch { /* 손상된 값 무시 */ }
  return null
}

/** 이 연도 캐시를 다시 받아야 하는가 (지난 연도는 확정이라 재조회 안 함) */
function isCacheStale(year: number, fetchedAt: number): boolean {
  if (year < new Date().getFullYear()) return false
  return Date.now() - fetchedAt > CACHE_TTL_MS
}

/** localStorage에 캐시된 공휴일 연도 목록을 적재 */
function loadCached(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(LS_PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const cache = parseCache(raw)
      if (!cache) continue
      CACHED_BY_YEAR.set(key.slice(LS_PREFIX.length), cache.dates)
    }
  } catch { /* localStorage 없는 환경(SSR 등) 무시 */ }
  rebuildHolidays()
}

loadCached()

/**
 * GAS에서 특정 연도 공휴일을 가져와 캐시 (앱 시작 시 1회 호출 권장)
 *
 * ⚠ 조회에 실패해도 기존 캐시는 그대로 둔다 — 지우면 그 순간 공휴일이 통째로
 *   하드코딩으로 되돌아가 판정이 흔들린다.
 */
export async function fetchAndCacheHolidays(year: number): Promise<void> {
  const lsKey = LS_PREFIX + year
  try {
    const raw = localStorage.getItem(lsKey)
    const cache = raw ? parseCache(raw) : null
    if (cache && !isCacheStale(year, cache.fetchedAt)) return  // 아직 신선함
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
    CACHED_BY_YEAR.set(String(year), json.dates)
    rebuildHolidays()
    const rec: HolidayCache = { fetchedAt: Date.now(), dates: json.dates }
    try { localStorage.setItem(lsKey, JSON.stringify(rec)) } catch { /* no-op */ }
  } catch { /* 네트워크 오류 — 기존 캐시·하드코딩 fallback 유지 */ }
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

/** n 영업일 뒤 날짜 (주말·공휴일 건너뜀) — 예: 매각 지시 등록일 + 3영업일 기한 계산 */
export function addBizDays(date: string, n: number): string {
  let result = date
  for (let i = 0; i < n; i++) result = nextBizDay(result)
  return result
}

/** date1 → date2 사이에 남은 영업일 수 (date2가 과거면 음수) — D-day 표시용 */
export function bizDaysBetween(date1: string, date2: string): number {
  if (date1 === date2) return 0
  const sign = date2 > date1 ? 1 : -1
  let cur = date1
  let count = 0
  while (cur !== date2) {
    cur = sign > 0 ? nextBizDay(cur) : prevBizDay(cur)
    count += sign
  }
  return count
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
