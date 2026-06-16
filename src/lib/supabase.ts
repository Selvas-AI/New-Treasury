import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

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

// ⚠️ [CRITICAL] Web Locks 데드락 우회
async function noopLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  return fn()
}

// ── Supabase 클라이언트 팩토리 ─────────────────────────────────
// export let 로 선언 → ES 모듈 live binding → resetSupabaseClient() 후
// 모든 import 위치에서 자동으로 새 클라이언트 참조
function makeClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      lock: noopLock,
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
  opts: { body?: unknown; match?: Record<string, string | number | boolean>; returning?: boolean; upsert?: boolean } = {},
): Promise<RestResult<T>> {
  const { body, match, returning = false, upsert = false } = opts
  let url = `${REST_URL}/${table}`
  if (match && Object.keys(match).length) url += `?${eqQuery(match)}`
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

/** INSERT — rows 단건/배열 */
export function restInsert<T = unknown>(table: string, rows: unknown, returning = false): Promise<RestResult<T>> {
  return restSend<T>('POST', table, { body: rows, returning })
}

/** UPSERT — unique 제약 충돌 시 merge (PostgREST resolution=merge-duplicates) */
export function restUpsert<T = unknown>(table: string, rows: unknown, returning = false): Promise<RestResult<T>> {
  return restSend<T>('POST', table, { body: rows, returning, upsert: true })
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
