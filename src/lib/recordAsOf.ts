/**
 * 과거 시점 레코드 복원 (2026-09-09)
 *
 * ⭐ 왜 필요한가 — 연장(rollover) 처리가 레코드를 덮어쓴다.
 *   정기예금을 연장할 때 새 레코드를 만들지 않고 **기존 레코드의 개시일·만기일을 수정**한다.
 *   그러면 지금 DB 에는 `start = 2026-08-21` 만 남아, 2026-06-25 잔액을 재구성할 때
 *   "그날엔 아직 시작도 안 한 예금"으로 판정돼 **통째로 사라진다**
 *   (2026-09-09 셀바스헬스케어 리포트 — 외화 정기예금이 6/25 가용운용에서 누락).
 *
 *   같은 이유로 금액·가용여부를 나중에 수정한 건도 과거가 현재 값으로 오염된다.
 *
 * ⭐ 복원 재료는 이미 있다 — `audit_logs.before_data`.
 *   변경 이력 로그가 수정 직전 스냅샷을 통째로 저장하고 있다.
 *   기준일 이후 발생한 로그 중 **가장 이른 것의 before_data** 가 곧 그 시점의 상태다.
 *
 *   복원 우선순위 — 정확한 것부터:
 *     ① 기준일 **이후** 첫 로그의 `before_data`  = 그 시점 직전 상태 (가장 정확)
 *     ② 기준일 **이전** 마지막 로그의 `after_data` = 그 시점에 유효했던 상태
 *     ③ 둘 다 없으면 현재 레코드
 *
 *   ②가 필요한 이유: `save()` 가 오랫동안 `after` 만 기록하고 `before` 는 남기지
 *   않았다(2026-09-09 확인). 그래서 ①만으로는 대부분의 수정이 복원되지 않는다.
 *   같은 스냅샷을 반대 방향에서 쓰면 그 공백을 상당 부분 메울 수 있다.
 *
 * ⚠ 한계는 정직하게 남긴다:
 *   · 감사 로그가 아예 없는 레코드는 복원할 수 없다 → 현재 값이 쓰인다.
 *   · DELETE 된 레코드는 지금 목록에 없으므로 살아나지 않는다.
 *   복원이 적용된 건은 `restored` 로 표시해 화면이 밝힌다.
 */

export interface AuditLogRow {
  id: string
  table_name: string
  record_id: string | null
  action: string
  created_at: string                        // ISO
  before_data: Record<string, unknown> | null
  after_data:  Record<string, unknown> | null
}

/** 레코드 id → 기준일 시점 스냅샷 */
export type AsOfSnapshots = Map<string, Record<string, unknown>>

/**
 * 기준일(date, YYYY-MM-DD) 시점의 레코드 상태 스냅샷을 만든다.
 *
 * 기준일 **다음날 0시 이후**의 로그만 대상으로 한다 — 기준일 당일에 일어난 수정은
 * 그날 잔액에 이미 반영된 것으로 본다(자금 입력은 하루 단위로 확정된다).
 */
export function buildAsOfSnapshots(logs: AuditLogRow[], date: string): AsOfSnapshots {
  const cutoff = `${date}T23:59:59.999`

  // ① 기준일 이후 첫 로그의 before_data
  const afterCut = new Map<string, { at: string; data: Record<string, unknown> }>()
  // ② 기준일 이전 마지막 로그의 after_data
  const beforeCut = new Map<string, { at: string; data: Record<string, unknown> }>()

  for (const log of logs) {
    if (!log.record_id) continue
    if (log.created_at > cutoff) {
      if (!log.before_data) continue
      const cur = afterCut.get(log.record_id)
      if (!cur || log.created_at < cur.at) {
        afterCut.set(log.record_id, { at: log.created_at, data: log.before_data })
      }
    } else {
      if (!log.after_data) continue
      const cur = beforeCut.get(log.record_id)
      if (!cur || log.created_at > cur.at) {
        beforeCut.set(log.record_id, { at: log.created_at, data: log.after_data })
      }
    }
  }

  const out: AsOfSnapshots = new Map()
  for (const [id, v] of beforeCut) out.set(id, v.data)   // ② 먼저 깔고
  for (const [id, v] of afterCut)  out.set(id, v.data)   // ① 로 덮어쓴다(더 정확)
  return out
}

/**
 * 현재 레코드 목록에 스냅샷을 덮어씌워 그 시점 목록을 만든다.
 * 스냅샷이 있는 건만 교체하고, 나머지는 현재 값을 그대로 쓴다.
 */
export function applyAsOf<T extends { id: string }>(
  records: T[],
  snapshots: AsOfSnapshots,
  fromDb: (row: Record<string, unknown>) => T,
): { records: T[]; restoredIds: Set<string> } {
  const restoredIds = new Set<string>()
  const out = records.map(r => {
    const snap = snapshots.get(r.id)
    if (!snap) return r
    try {
      restoredIds.add(r.id)
      // 스냅샷은 DB 행 형태(snake_case)라 반드시 fromDb 를 거친다.
      // ⚠ 직접 캐스팅하면 start_date→start 매핑이 빠져 개시일이 사라진다(세션20차 전례).
      return fromDb(snap)
    } catch {
      restoredIds.delete(r.id)
      return r
    }
  })
  return { records: out, restoredIds }
}
