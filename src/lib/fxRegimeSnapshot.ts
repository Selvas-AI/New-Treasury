/**
 * fxRegimeSnapshot — 리짐 판정 결과의 경량 스냅샷
 *
 * 세션26차 Phase 4. 근거: docs/기획/FX리짐_정책이관_계획.md §6, §9
 *
 * ⭐ 왜 스냅샷이 필요한가
 *   대시보드·자금일보에서 "리짐 권고 미이행"을 감지하려면 두 가지가 필요하다.
 *     ① 권고가 **언제 처음 났는지** — 경과일을 세려면 기산점이 있어야 하는데,
 *        권고는 매각 지시로 등록되기 전까지 어디에도 저장되지 않았다.
 *     ② **가벼운 조회** — 판정에는 환율 이력 1,000여 건과 FIFO 로트가 필요하다.
 *        모든 사용자가 여는 대시보드에서 매번 엔진을 돌릴 수는 없다.
 *   그래서 실무 화면이 판정할 때 결과 요약만 policy_params 에 남기고,
 *   다른 화면은 그 숫자만 읽는다.
 *
 * ⚠ 스냅샷은 **판정의 사본**이지 판정 자체가 아니다.
 *   집행 판단은 항상 실무 화면(실시간 evaluateRegime)에서 한다.
 *   스냅샷이 오래됐으면(asOf 가 과거) 그 사실을 화면에 표시할 것.
 */

/** policy_params 키 — 통화별 스냅샷 */
export const REGIME_SNAPSHOT_KEYS = {
  /** 적용 목표 잔존비중 (%) */
  targetPct:  (cur: string) => `fx_regime_snap_target_${cur.toLowerCase()}`,
  /** 판정 시점 현재 외화비중 (%) */
  currentPct: (cur: string) => `fx_regime_snap_current_${cur.toLowerCase()}`,
  /** 권고 매도액 (원, 양수). 0 = 조치 불필요 */
  suggestKRW: (cur: string) => `fx_regime_snap_suggest_${cur.toLowerCase()}`,
  /** 권고가 처음 발생한 날 (param_text, YYYY-MM-DD). 조치 불필요로 돌아가면 지운다 */
  since:      (cur: string) => `fx_regime_snap_since_${cur.toLowerCase()}`,
  /** 판정 기준일 (param_text, YYYY-MM-DD) — 스냅샷 신선도 */
  asOf:       (cur: string) => `fx_regime_snap_asof_${cur.toLowerCase()}`,
} as const

export interface RegimeSnapshot {
  currency:   string
  targetPct:  number | null
  currentPct: number | null
  /** 권고 매도액 (원, 양수). 0 = 조치 불필요 */
  suggestKRW: number
  since:      string | null
  asOf:       string | null
}

interface SnapshotReader {
  get: (key: string) => number | null
  getText: (key: string) => string | null
}

export function readRegimeSnapshot(params: SnapshotReader, currency: string): RegimeSnapshot | null {
  const asOf = params.getText(REGIME_SNAPSHOT_KEYS.asOf(currency))
  if (!asOf) return null   // 아직 한 번도 판정하지 않은 통화
  return {
    currency,
    targetPct:  params.get(REGIME_SNAPSHOT_KEYS.targetPct(currency)),
    currentPct: params.get(REGIME_SNAPSHOT_KEYS.currentPct(currency)),
    suggestKRW: params.get(REGIME_SNAPSHOT_KEYS.suggestKRW(currency)) ?? 0,
    since:      params.getText(REGIME_SNAPSHOT_KEYS.since(currency)),
    asOf,
  }
}

export function readAllRegimeSnapshots(params: SnapshotReader, currencies: readonly string[]): RegimeSnapshot[] {
  return currencies
    .map(c => readRegimeSnapshot(params, c))
    .filter((s): s is RegimeSnapshot => s !== null)
}

interface SnapshotWriter extends SnapshotReader {
  set: (key: string, value: number | null, text: string | null, updatedBy: string) => Promise<string | null>
}

/** 히스토리 1건 — 실제 저장 방식(DB 테이블 등)은 호출부가 주입한다(테스트 가능성 유지). */
export interface RegimeSnapshotHistoryEntry {
  currency: string
  targetPct: number | null
  currentPct: number | null
  suggestKRW: number
  sinceDate: string | null
  snapshotDate: string
  capturedBy: string
}

/**
 * 판정 결과를 스냅샷에 반영한다. **변경이 없으면 아무것도 쓰지 않는다.**
 *
 * `since`(권고 최초 발생일) 규칙:
 *   조치 불필요 → 권고 발생: 오늘로 설정
 *   권고 지속:              그대로 둔다 (경과일이 늘어난다)
 *   권고 → 조치 불필요:      지운다
 *
 * `recordHistory` 를 주입하면 값이 바뀔 때마다(=아래에서 실제로 쓸 때만) 이력 1건을
 * 남긴다(세션26차 7일차 — 스냅샷은 덮어쓰기라 "매각 후 조치 카드가 사라져 그 당시
 * 상황을 추적할 수 없다"는 문제가 있었다). 이 함수 자체는 DB 를 모르는 순수 로직으로
 * 유지한다 — 실제 insert 는 호출부(FxRegimePage.tsx)가 주입.
 *
 * @returns 실제로 쓴 키 개수 (0 = 변경 없음)
 */
export async function syncRegimeSnapshot(
  params: SnapshotWriter,
  currency: string,
  next: { targetPct: number | null; currentPct: number | null; suggestKRW: number; asOf: string },
  today: string,
  updatedBy: string,
  recordHistory?: (entry: RegimeSnapshotHistoryEntry) => Promise<void>,
): Promise<number> {
  const prev = readRegimeSnapshot(params, currency)
  const prevSuggest = prev?.suggestKRW ?? 0
  const suggest = Math.max(0, Math.round(next.suggestKRW))

  // 권고 상태가 그대로이고 판정일·수치도 같으면 쓸 이유가 없다.
  const unchanged = prev
    && prev.asOf === next.asOf
    && prev.suggestKRW === suggest
    && prev.targetPct === next.targetPct
    && prev.currentPct === next.currentPct
  if (unchanged) return 0

  let nextSince: string | null
  if (suggest > 0 && prevSuggest === 0) nextSince = today
  else if (suggest === 0 && prevSuggest > 0) nextSince = null
  else nextSince = prev?.since ?? null

  const writes: Promise<string | null>[] = [
    params.set(REGIME_SNAPSHOT_KEYS.targetPct(currency),  next.targetPct,  null, updatedBy),
    params.set(REGIME_SNAPSHOT_KEYS.currentPct(currency), next.currentPct, null, updatedBy),
    params.set(REGIME_SNAPSHOT_KEYS.suggestKRW(currency), suggest,         null, updatedBy),
    params.set(REGIME_SNAPSHOT_KEYS.asOf(currency),       null,            next.asOf, updatedBy),
  ]

  if (suggest > 0 && prevSuggest === 0) {
    writes.push(params.set(REGIME_SNAPSHOT_KEYS.since(currency), null, today, updatedBy))
  } else if (suggest === 0 && prevSuggest > 0) {
    writes.push(params.set(REGIME_SNAPSHOT_KEYS.since(currency), null, null, updatedBy))
  }

  // ⚠ 순차 실행 — 같은 (company, param_key) 유니크 제약에 동시 upsert 를 던지면
  //   PostgREST 가 409 를 반환할 수 있다.
  let n = 0
  for (const w of writes) { await w; n++ }

  if (recordHistory) {
    await recordHistory({
      currency, targetPct: next.targetPct, currentPct: next.currentPct,
      suggestKRW: suggest, sinceDate: nextSince, snapshotDate: next.asOf, capturedBy: updatedBy,
    })
  }

  return n
}

/** 권고 발생 후 경과 영업일. 권고가 없거나 기산점이 없으면 null */
export function pendingDays(
  snap: RegimeSnapshot | null,
  today: string,
  bizDaysBetweenFn: (a: string, b: string) => number,
): number | null {
  if (!snap || snap.suggestKRW <= 0 || !snap.since) return null
  return Math.max(0, bizDaysBetweenFn(snap.since, today))
}
