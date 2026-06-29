import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// ── 브라우저 종료 시 자동 로그아웃 (sessionStorage 플래그 방식) ─────────────
// 원리: Supabase Auth 세션은 기본적으로 localStorage에 영구 저장된다.
//      sessionStorage는 탭/브라우저 완전 종료 시 자동 소멸한다 (F5 리프레시는 유지).
// 해결: 앱 초기화 시 sessionStorage 플래그 부재 → 새 브라우저 기동 → localStorage
//      Auth 토큰·프로필 캐시를 즉시 제거 → 로그인 화면으로 이동.
//      F5 리프레시 시에는 플래그가 살아있으므로 → 로그인 유지.
// 주의: makeClient() 보다 반드시 먼저 실행돼야 Supabase 클라이언트가 빈 저장소를 본다.
const _SESSION_FLAG = 'treasury_session_alive'
if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(_SESSION_FLAG)) {
  // 새 브라우저 세션 → localStorage의 Supabase 토큰 및 캐시 전부 제거
  if (typeof localStorage !== 'undefined') {
    Object.keys(localStorage)
      .filter(k =>
        (k.startsWith('sb-') && (k.endsWith('-auth-token') || k.endsWith('-code-verifier')))
        || k === 'treasury_profile_cache',
      )
      .forEach(k => localStorage.removeItem(k))
  }
}
// 현재 브라우저 탭이 살아있는 동안 플래그 유지 (브라우저 종료 시 자동 소멸)
if (typeof sessionStorage !== 'undefined') {
  sessionStorage.setItem(_SESSION_FLAG, '1')
}

// Supabase 네트워크 요청 타임아웃
// - 인증(auth) 요청: 타임아웃 미적용 — 토큰 갱신이 abort되면 SIGNED_OUT 발생 → 강제 로그아웃
// - 데이터 API 요청: 5초 — hang 감지 + withTimeout(6s) 조합으로 완전 보호
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isAuthRequest = url.includes('/auth/v1/')
  if (isAuthRequest) return fetch(input as RequestInfo, init ?? {})
  const controller = new AbortController()
  const tid = window.setTimeout(() => controller.abort(), 5_000)
  return fetch(input as RequestInfo, { ...init, signal: controller.signal })
    .finally(() => window.clearTimeout(tid))
}

// ⚠️ [CRITICAL] Web Locks 전략 — 데드락 차단 + 멀티탭 토큰 회전 경쟁 차단
// 배경:
//   supabase-js 기본 navigatorLock 은 acquireTimeout=-1(무한 대기) → 락 보유자가
//   wedge되면 이후 모든 auth 호출이 영구 대기(로그인 '처리 중…' 무한 행).
//   과거: lock 을 no-op 으로 완전 우회 → 데드락은 막았으나, 멀티탭에서 각 탭이
//   독립적으로 토큰을 갱신 → refresh token 회전(rotation) 경쟁 → invalid_grant →
//   전 탭 SIGNED_OUT(동시 로그아웃) 발생.
// 현재 전략:
//   navigator.locks 로 크로스탭 토큰 갱신을 직렬화하되, 획득 대기에 타임아웃을 걸어
//   절대 무한 대기하지 않는다.
//   - 정상: 락 즉시 획득 → 탭 간 갱신 직렬화 → 회전 경쟁 차단
//   - 경합/지연/wedge: timeout 후 degrade(직접 실행) → 데드락 원천 차단
//   - fn 자체 에러는 재실행하지 않음(중복 실행 방지)
const LOCK_ACQUIRE_TIMEOUT_MS = 4_000

async function safeLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  // Web Locks 미지원 환경 → 직접 실행
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  const key = `lock:${name}`
  const ac = new AbortController()
  const timeoutMs = acquireTimeout > 0 ? acquireTimeout : LOCK_ACQUIRE_TIMEOUT_MS
  const tid = window.setTimeout(() => ac.abort(), timeoutMs)
  let acquired = false
  try {
    return await navigator.locks.request(
      key,
      // acquireTimeout===0: 즉시 가능할 때만(대기 없음). 그 외: 타임아웃부 대기.
      acquireTimeout === 0 ? { mode: 'exclusive', ifAvailable: true } : { mode: 'exclusive', signal: ac.signal },
      async () => { acquired = true; return await fn() },
    )
  } catch (e) {
    // 락 획득 실패(AbortError/미가용)일 때만 degrade. fn 내부 에러면 재실행 금지.
    if (acquired) throw e
    return await fn()
  } finally {
    window.clearTimeout(tid)
  }
}

// ── Supabase 클라이언트 팩토리 ─────────────────────────────────
// export let 로 선언 → ES 모듈 live binding → resetSupabaseClient() 후
// 모든 import 위치에서 자동으로 새 클라이언트 참조
function makeClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      lock: safeLock,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: { fetch: fetchWithTimeout },
  })
}

// eslint-disable-next-line prefer-const
export let supabase = makeClient()

/**
 * supabase-js Wedge 상태 복구용 클라이언트 재생성.
 * 내부 상태머신이 꼬인 경우(네트워크 에러 후 Promise 영구 미해결) 새 인스턴스로 교체.
 * - ES 모듈 live binding → 재생성 즉시 모든 훅이 새 클라이언트 사용
 * - 기존 onAuthStateChange 구독은 무효화되나, Auth는 localStorage 세션으로 복원됨
 */
export function resetSupabaseClient(): void {
  supabase = makeClient()
}

// ─────────────────────────────────────────────────────────────
// REST 쓰기 헬퍼 (raw fetch 기반)
//
// 배경: supabase-js v2 의 .insert()/.update()/.delete() 는 권한(RLS) 거부(403) 등
//   특정 오류를 받으면 내부 재시도·토큰갱신 로직이 꼬여 Promise 가 영구 미해결(wedge)
//   상태가 되고, 이후 같은 클라이언트의 SELECT 까지 멈추는 사례가 확인됨
//   (CLAUDE.md §10 'RLS auth.users 403' 참조).
// 대응: 쓰기는 PostgREST REST 엔드포인트로 직접 fetch 한다.
//   - fetchWithTimeout(12s) 로 항상 응답/중단 보장 → 영구 hang 불가
//   - 응답을 직접 파싱해 { data, error } 반환 (supabase-js 와 동일 형태)
//   - 클라이언트 wedge 자체가 발생하지 않음
// 읽기(SELECT)는 기존 supabase.from().select() 사용 (wedge 유발 안 함).
// ─────────────────────────────────────────────────────────────

const REST_URL = `${supabaseUrl}/rest/v1`

/** 현재 세션 토큰(없으면 anon key) + apikey 헤더 */
function restHeaders(): Record<string, string> {
  let token = supabaseKey
  try {
    const authKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (authKey) {
      const parsed = JSON.parse(localStorage.getItem(authKey) ?? '{}') as { access_token?: string }
      if (parsed.access_token) token = parsed.access_token
    }
  } catch { /* anon 키 사용 */ }
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export interface RestResult<T = unknown> {
  data: T[] | null
  error: { message: string; status: number } | null
}

/** eq 매치 객체 → PostgREST 쿼리스트링 (col=eq.value) */
function eqQuery(match: Record<string, string | number | boolean>): string {
  return Object.entries(match)
    .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`)
    .join('&')
}

async function restSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  table: string,
  opts: { body?: unknown; match?: Record<string, string | number | boolean>; returning?: boolean; upsert?: boolean; onConflict?: string } = {},
): Promise<RestResult<T>> {
  const { body, match, returning = false, upsert = false, onConflict } = opts
  let url = `${REST_URL}/${table}`
  const queryParts: string[] = []
  if (match && Object.keys(match).length) queryParts.push(eqQuery(match))
  if (upsert && onConflict) queryParts.push(`on_conflict=${encodeURIComponent(onConflict)}`)
  if (queryParts.length) url += `?${queryParts.join('&')}`
  const prefer = [
    returning ? 'return=representation' : 'return=minimal',
    upsert ? 'resolution=merge-duplicates' : '',
  ].filter(Boolean).join(',')
  try {
    const resp = await fetchWithTimeout(url, {
      method,
      headers: { ...restHeaders(), Prefer: prefer },
      body: body != null ? JSON.stringify(body) : undefined,
    })
    if (!resp.ok) {
      let message = `${resp.status} ${resp.statusText}`
      try {
        const j = await resp.json() as { message?: string; hint?: string }
        if (j.message) message = j.message + (j.hint ? ` (${j.hint})` : '')
      } catch { /* 본문 없음 */ }
      return { data: null, error: { message, status: resp.status } }
    }
    let data: T[] | null = null
    if (returning) { try { data = await resp.json() as T[] } catch { data = null } }
    return { data, error: null }
  } catch (e) {
    const message = e instanceof Error
      ? (e.name === 'AbortError' ? '요청 시간 초과 (12초)' : e.message)
      : '네트워크 오류'
    return { data: null, error: { message, status: 0 } }
  }
}

/** GET — match 조건으로 행 조회 (supabase-js 클라이언트 우회, PostgREST 직접 호출) */
export async function restGet<T = unknown>(
  table: string,
  match: Record<string, string | number | boolean>,
): Promise<RestResult<T>> {
  const url = `${REST_URL}/${table}?${eqQuery(match)}`
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { ...restHeaders(), Accept: 'application/json' },
    })
    if (!resp.ok) {
      let message = `${resp.status} ${resp.statusText}`
      try { const j = await resp.json() as { message?: string }; if (j.message) message = j.message } catch { /* */ }
      return { data: null, error: { message, status: resp.status } }
    }
    const data = await resp.json() as T[]
    return { data, error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : '네트워크 오류'
    return { data: null, error: { message, status: 0 } }
  }
}

/**
 * SELECT — 정렬·범위·추가 필터 지원 조회 (supabase-js 클라이언트 우회, PostgREST 직접 호출)
 *
 * 배경: supabase-js 의 .from().select() 는 _getAccessToken() 단계에서 토큰 자동갱신
 *   (autoRefreshToken)이 진행 중이면 그 락(safeLock) 뒤에서 대기한다. 첫 페이지 로드 시
 *   토큰이 만료 임박이면 갱신이 트리거되고, auth fetch 는 타임아웃이 없어 select 가
 *   withTimeout(6s)을 넘겨 빈 결과로 굳는 사례가 확인됨(대시보드 초기 0원 → 새로고침/법인전환 후 정상).
 *   → 읽기를 REST 로 직접 호출하면 localStorage 토큰을 즉시 사용해 갱신 락과 무관하게 동작.
 *
 * opts:
 *   - match: col=eq.value 필터 (예: { company: '...', active: true })
 *   - order: 'date.desc' / 'maturity.asc' 형식 (PostgREST order 구문)
 *   - limit: 최대 행 수
 */
export async function restSelect<T = unknown>(
  table: string,
  opts: { match?: Record<string, string | number | boolean>; order?: string; limit?: number } = {},
): Promise<RestResult<T>> {
  const parts: string[] = ['select=*']
  if (opts.match && Object.keys(opts.match).length) parts.push(eqQuery(opts.match))
  if (opts.order) parts.push(`order=${encodeURIComponent(opts.order)}`)
  if (opts.limit != null) parts.push(`limit=${opts.limit}`)
  const url = `${REST_URL}/${table}?${parts.join('&')}`
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { ...restHeaders(), Accept: 'application/json' },
    })
    if (!resp.ok) {
      let message = `${resp.status} ${resp.statusText}`
      try { const j = await resp.json() as { message?: string }; if (j.message) message = j.message } catch { /* */ }
      return { data: null, error: { message, status: resp.status } }
    }
    const data = await resp.json() as T[]
    return { data, error: null }
  } catch (e) {
    const message = e instanceof Error
      ? (e.name === 'AbortError' ? '요청 시간 초과' : e.message)
      : '네트워크 오류'
    return { data: null, error: { message, status: 0 } }
  }
}

/** INSERT — rows 단건/배열 */
export function restInsert<T = unknown>(table: string, rows: unknown, returning = false): Promise<RestResult<T>> {
  return restSend<T>('POST', table, { body: rows, returning })
}

/** UPSERT — unique 제약 충돌 시 merge (PostgREST resolution=merge-duplicates)
 *  onConflict: 충돌 기준 컬럼(들), 예) 'company,report_date' */
export function restUpsert<T = unknown>(table: string, rows: unknown, returning = false, onConflict?: string): Promise<RestResult<T>> {
  return restSend<T>('POST', table, { body: rows, returning, upsert: true, onConflict })
}

/** UPDATE — match 조건에 values 적용 */
export function restUpdate<T = unknown>(
  table: string, values: unknown, match: Record<string, string | number | boolean>, returning = false,
): Promise<RestResult<T>> {
  return restSend<T>('PATCH', table, { body: values, match, returning })
}

/** DELETE — match 조건 행 삭제 */
export function restDelete<T = unknown>(
  table: string, match: Record<string, string | number | boolean>, returning = false,
): Promise<RestResult<T>> {
  return restSend<T>('DELETE', table, { match, returning })
}

/** UPDATE — column 값이 ids 중 하나인 행들(.in 필터)에 values 적용 */
export async function restUpdateIn<T = unknown>(
  table: string, values: unknown, column: string, ids: (string | number)[],
): Promise<RestResult<T>> {
  if (ids.length === 0) return { data: [], error: null }
  const list = ids.map(v => encodeURIComponent(String(v))).join(',')
  const url = `${REST_URL}/${table}?${encodeURIComponent(column)}=in.(${list})`
  try {
    const resp = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: { ...restHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(values),
    })
    if (!resp.ok) {
      let message = `${resp.status} ${resp.statusText}`
      try { const j = await resp.json() as { message?: string }; if (j.message) message = j.message } catch { /* */ }
      return { data: null, error: { message, status: resp.status } }
    }
    return { data: null, error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : '네트워크 오류', status: 0 } }
  }
}

/**
 * 읽기(SELECT) 보호용 타임아웃 래퍼.
 * supabase-js 클라이언트가 이전 쓰기 오류로 wedge되면 SELECT Promise가 영구 미해결될 수 있다.
 * fetchWithTimeout(12s)은 fetch가 실제로 호출돼야 동작하지만, wedge는 fetch 호출 이전 단계라
 * 보호가 안 된다 → 이 래퍼로 호출부에서 강제 타임아웃을 보장해 loading이 영구히 멈추지 않게 한다.
 */
export function withTimeout<T>(p: PromiseLike<T>, ms = 6_000, label = '데이터 조회'): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}s)`)), ms),
    ),
  ])
}

/** 날짜 내림차순 정렬 */
export function sortByDate<T extends Record<string, unknown>>(
  records: T[],
  key = 'date',
): T[] {
  return [...records].sort((a, b) =>
    String(b[key] ?? '').localeCompare(String(a[key] ?? '')),
  )
}
