/**
 * useFxHistory — 일별 환율 이력 (fx_rate_history)
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 1
 *
 * 역할 분담:
 *   - 조회: Supabase(fx_rate_history) 단일 소스. GAS를 매번 호출하지 않는다.
 *   - 수집: GAS ?type=fxhistory → ECOS. 백필(수동) + 일일 보충(자동, 1일 1회).
 *
 * ⚠ GAS 할당량 주의 (세션17차 UrlFetch 폭발 전례):
 *   폴링 금지. 일일 보충은 "마지막 저장일 < 전영업일"일 때만 1회, 그리고
 *   isGasBlocked() 서킷브레이커가 열려 있으면 조용히 skip 한다.
 *
 * ⚠ JPY 단위:
 *   ECOS 는 "원/100엔" 이라 DB 에 unit_basis=100 으로 저장된다.
 *   1엔당 환율이 필요하면 rate / unit_basis 로 정규화할 것 → normalizedRate() 사용.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { restSelect, restUpsert } from '../lib/supabase'
import { fetchFxHistory, isGasBlocked } from './useGas'
import { prevBizDay, todayStr } from '../lib/bizDay'

/** ECOS가 100단위로 고시하는 통화 (원/100엔) */
const UNIT_BASIS: Record<string, number> = { JPY: 100 }

export interface FxRatePoint {
  date: string        // YYYY-MM-DD
  rate: number        // unit_basis 단위당 원화 (DB 원값)
  unitBasis: number   // 1 또는 100
}

/** 1외화당 원화로 정규화 (JPY 100엔 기준 보정) */
export function normalizedRate(p: FxRatePoint): number {
  return p.unitBasis > 1 ? p.rate / p.unitBasis : p.rate
}

interface FxRateRow {
  currency:   string
  rate_date:  string
  rate:       number | string
  unit_basis: number | null
}

function fromDb(r: FxRateRow): FxRatePoint {
  return {
    date:      r.rate_date,
    rate:      typeof r.rate === 'string' ? parseFloat(r.rate) : r.rate,
    unitBasis: r.unit_basis ?? 1,
  }
}

/** YYYY-MM-DD → YYYYMMDD (ECOS 형식) */
function toEcosDate(d: string): string {
  return d.replace(/-/g, '')
}

/** Date → YYYY-MM-DD (로컬 타임존 기준 — toISOString 은 UTC 로 하루 밀릴 수 있음) */
function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// ── 수집 ──────────────────────────────────────────────────────────────

export interface BackfillProgress {
  currency: string
  year:     number
  fetched:  number
  saved:    number
  /** 이 연도가 실패했다면 사유 */
  error?:   string
}

export interface BackfillResult {
  saved:  number
  failed: { year: number; error: string }[]
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * ECOS → Supabase 백필. 연 단위로 쪼개 순차 호출한다.
 *
 * ⚠ 연 단위 분할은 선택이 아니라 필수 — ECOS 는 1회 500건 상한이라
 *   여러 해를 한 번에 요청하면 뒷 구간이 조용히 잘린다.
 *
 * ⚠ 한 해가 실패해도 전체를 중단하지 않는다.
 *   실측(2026-08-11): 5개 연도 연속 호출 중 2023년에서 GAS UrlFetch 가
 *   "사용할 수 없는 주소" 예외를 던졌다(ECOS 측 일시 거부로 추정).
 *   배치 전체를 abort 하면 나머지 3개 연도까지 버려지므로, 연도별로 1회 재시도한 뒤
 *   그래도 실패하면 기록만 남기고 다음 연도로 넘어간다.
 *   upsert 라 실패한 연도만 다시 돌려도 안전하다.
 */
export async function backfillFxHistory(
  currency: string,
  fromYear: number,
  toYear: number,
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillResult> {
  if (isGasBlocked()) {
    throw new Error('GAS 호출이 일시 차단된 상태입니다(할당량 보호). 잠시 후 다시 시도하세요.')
  }

  const unitBasis = UNIT_BASIS[currency] ?? 1
  const today     = todayStr()
  const failed: { year: number; error: string }[] = []
  let total = 0

  for (let y = fromYear; y <= toYear; y++) {
    if (isGasBlocked()) {
      failed.push({ year: y, error: 'GAS 차단(할당량 보호)' })
      continue
    }

    const from = `${y}0101`
    // 올해는 오늘까지만 (미래 구간 요청 방지)
    const to = y === new Date().getFullYear() ? toEcosDate(today) : `${y}1231`

    let lastErr = ''
    let done = false

    // 3회까지 시도 — GAS UrlFetch 가 같은 호스트로 연속 호출할 때 간헐적으로
    // "사용할 수 없는 주소" 예외를 던진다(실측: 동일 연도를 단독 호출하면 정상).
    // 연도 특성이 아니라 일시적 거부이므로 백오프 후 재시도하면 대부분 통과한다.
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const res = await fetchFxHistory(currency, from, to)
        if (res.rates.length) {
          const rows = res.rates.map(r => ({
            currency,
            rate_date:  r.date,
            rate:       r.rate,
            unit_basis: unitBasis,
            source:     'ecos',
          }))
          // unique(currency, rate_date) → 재실행해도 중복이 쌓이지 않음
          const up = await restUpsert('fx_rate_history', rows, false, 'currency,rate_date')
          if (up.error) throw new Error(`저장 실패: ${up.error.message}`)
          total += rows.length
        }
        onProgress?.({ currency, year: y, fetched: res.rates.length, saved: total })
        done = true
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
        if (attempt < 3) {
          const wait = attempt * 8000   // 8s → 16s 지수적 백오프
          onProgress?.({ currency, year: y, fetched: 0, saved: total,
            error: `재시도 ${attempt}/2 (${Math.round(wait / 1000)}초 후) — ${lastErr.slice(0, 50)}` })
          await sleep(wait)
        }
      }
    }

    if (!done) {
      failed.push({ year: y, error: lastErr })
      onProgress?.({ currency, year: y, fetched: 0, saved: total, error: lastErr })
    }
    // ECOS 연속 호출 간 간격 — 일시 거부 완화
    if (y < toYear) await sleep(5000)
  }

  return { saved: total, failed }
}

// 일일 보충이 이번 세션에서 이미 실행됐는지 (통화별) — 렌더마다 재호출 방지
const syncedToday = new Set<string>()

/**
 * 마지막 저장일 이후 ~ 전영업일 구간만 보충. 없으면 아무것도 하지 않는다.
 * @returns 저장 건수 (0 = 이미 최신이거나 skip)
 */
export async function syncLatestFxHistory(currency: string): Promise<number> {
  const todayKey = `${currency}_${todayStr()}`
  if (syncedToday.has(todayKey)) return 0
  if (isGasBlocked()) return 0

  const target = prevBizDay(todayStr())

  const last = await restSelect<FxRateRow>('fx_rate_history', {
    match: { currency },
    order: 'rate_date.desc',
    limit: 1,
  })
  if (last.error) return 0

  const lastDate = last.data?.[0]?.rate_date
  // 이력이 아예 없으면 자동 보충 대상이 아님 — 백필을 먼저 돌려야 한다
  if (!lastDate) return 0
  if (lastDate >= target) { syncedToday.add(todayKey); return 0 }

  syncedToday.add(todayKey)   // 성공/실패 무관 — 오늘은 더 재시도하지 않는다

  // ⚠ 갭을 한 번에 요청하면 안 된다.
  //   ECOS 는 1회 500건 상한이라, 백필이 중간에 실패해 몇 년치 구멍이 생긴 상태에서
  //   "마지막 저장일 ~ 오늘"을 통째로 요청하면 앞 500건만 저장되고 뒤가 조용히 잘린다.
  //   (실측: 2022-12-30 ~ 2026-08 요청 → 2025-01-14 까지만 저장돼 이후 구간이 통째로 유실)
  //   → 연 경계로 끊어 순차 요청한다.
  const unitBasis = UNIT_BASIS[currency] ?? 1
  let cursor = new Date(`${lastDate}T00:00:00`)
  cursor.setDate(cursor.getDate() + 1)
  let saved = 0

  // 연 단위이므로 최대 반복은 (연도 수). 무한 루프 방지용 상한도 함께 둔다.
  for (let guard = 0; guard < 30; guard++) {
    const from = fmtDate(cursor)
    if (from > target) break

    const yearEnd = `${cursor.getFullYear()}-12-31`
    const to = yearEnd < target ? yearEnd : target

    const res = await fetchFxHistory(currency, toEcosDate(from), toEcosDate(to))
    if (res.rates.length) {
      const up = await restUpsert(
        'fx_rate_history',
        res.rates.map(r => ({
          currency, rate_date: r.date, rate: r.rate, unit_basis: unitBasis, source: 'ecos',
        })),
        false,
        'currency,rate_date',
      )
      if (up.error) break
      saved += res.rates.length
    }

    cursor = new Date(`${to}T00:00:00`)
    cursor.setDate(cursor.getDate() + 1)
    if (to === target) break
    await sleep(5000)   // 연속 호출 간 간격
  }

  return saved
}

// ── 훅 ────────────────────────────────────────────────────────────────

export interface UseFxHistoryOptions {
  /** 조회 시작일 YYYY-MM-DD. 생략 시 전 구간 */
  from?: string
  /** 마운트 시 일일 보충 자동 실행 (기본 false — 명시적으로 켤 것) */
  autoSync?: boolean
}

/**
 * ⚠ 반환 객체는 반드시 메모이즈한다 (세션12차 무한 렌더 루프 전례).
 *   이 훅의 data 는 useMemo/useEffect deps 로 흘러들어간다.
 */
export function useFxHistory(currency: string, opts: UseFxHistoryOptions = {}) {
  const { from, autoSync = false } = opts

  const [data, setData]       = useState<FxRatePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // 법인 전환 패턴과 동일 — 응답 순서 뒤바뀜 방지
  const fetchIdRef = useRef(0)

  const load = useCallback(async () => {
    const myId = ++fetchIdRef.current
    setLoading(true)
    setError(null)
    setData([])

    // ⚠ Supabase PostgREST 는 서버측 max-rows=1000 이 걸려 있어, limit 을 크게 줘도
    //   한 번에 1,000행까지만 돌려준다(실측: 5년치 요청 시 2026-01-28 에서 잘림 —
    //   조용히 잘리기 때문에 "데이터가 거기까지만 있는 것"으로 오해하기 쉽다).
    //   → rate_date 를 커서로 쓰는 keyset 페이지네이션으로 전부 읽는다.
    const PAGE = 1000
    const all: FxRateRow[] = []
    let cursor = from ?? null
    let firstPage = true

    for (let guard = 0; guard < 20; guard++) {
      const filters: string[] = []
      if (cursor) filters.push(`rate_date=${firstPage ? 'gte' : 'gt'}.${cursor}`)

      const res = await restSelect<FxRateRow>('fx_rate_history', {
        match:   { currency },
        filters: filters.length ? filters : undefined,
        order:   'rate_date.asc',
        limit:   PAGE,
      })
      if (res.error) {
        setLoading(false)
        if (myId === fetchIdRef.current) setError(res.error.message)
        return
      }
      const page = res.data ?? []
      all.push(...page)
      if (page.length < PAGE) break
      cursor = page[page.length - 1].rate_date
      firstPage = false
    }

    setLoading(false)
    if (myId !== fetchIdRef.current) return   // stale 응답 폐기
    setData(all.map(fromDb))
  }, [currency, from])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!autoSync) return
    let cancelled = false
    void (async () => {
      try {
        const n = await syncLatestFxHistory(currency)
        if (n > 0 && !cancelled) await load()
      } catch { /* 보충 실패는 조용히 무시 — 기존 이력으로 계속 동작 */ }
    })()
    return () => { cancelled = true }
  }, [currency, autoSync, load])

  const latest = data.length ? data[data.length - 1] : null

  return useMemo(
    () => ({ data, latest, loading, error, reload: load }),
    [data, latest, loading, error, load],
  )
}
