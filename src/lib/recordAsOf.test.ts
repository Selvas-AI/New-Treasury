import { describe, it, expect } from 'vitest'
import { buildAsOfSnapshots, applyAsOf, type AuditLogRow } from './recordAsOf'

function log(p: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: 'l1', table_name: 'investments', record_id: 'r1', action: 'UPDATE',
    created_at: '2026-08-21T11:49:00', before_data: null, after_data: null, ...p,
  }
}

describe('buildAsOfSnapshots', () => {
  // ⭐ 실사례 — 정기예금 연장 시 기존 레코드의 개시일·만기일을 덮어썼다.
  //   지금 DB 만 보면 start=2026-08-21 이라 6/25 잔액에서 사라진다.
  it('기준일 이후 첫 수정의 before_data 가 그 시점 상태다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-08-21T11:49:00', before_data: { id: 'r1', start_date: '2026-05-23', amount: 2_000_000 } }),
      log({ created_at: '2026-11-23T09:00:00', before_data: { id: 'r1', start_date: '2026-08-21', amount: 2_000_000 } }),
    ], '2026-06-25')
    expect(snaps.get('r1')).toEqual({ id: 'r1', start_date: '2026-05-23', amount: 2_000_000 })
  })

  it('기준일 이전 변경은 이미 반영된 것이므로 무시한다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-05-01T10:00:00', before_data: { id: 'r1', amount: 1 } }),
    ], '2026-06-25')
    expect(snaps.size).toBe(0)
  })

  it('기준일 당일 변경도 그날 잔액에 반영된 것으로 본다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-06-25T18:00:00', before_data: { id: 'r1', amount: 1 } }),
    ], '2026-06-25')
    expect(snaps.size).toBe(0)
  })

  it('before_data 가 없는 로그(CREATE 등)는 건너뛴다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-08-01T10:00:00', action: 'CREATE', before_data: null }),
    ], '2026-06-25')
    expect(snaps.size).toBe(0)
  })

  it('레코드가 여럿이면 각각 가장 이른 로그를 쓴다', () => {
    const snaps = buildAsOfSnapshots([
      log({ record_id: 'a', created_at: '2026-09-01T10:00:00', before_data: { id: 'a', amount: 10 } }),
      log({ record_id: 'a', created_at: '2026-07-01T10:00:00', before_data: { id: 'a', amount: 20 } }),
      log({ record_id: 'b', created_at: '2026-07-05T10:00:00', before_data: { id: 'b', amount: 30 } }),
    ], '2026-06-25')
    expect(snaps.get('a')).toEqual({ id: 'a', amount: 20 })
    expect(snaps.get('b')).toEqual({ id: 'b', amount: 30 })
  })
})

describe('buildAsOfSnapshots — after_data 폴백', () => {
  // save() 가 오랫동안 before 를 남기지 않아, before_data 만으로는 대부분 복원되지 않는다.
  // 기준일 이전 마지막 로그의 after_data 가 그 시점에 유효했던 상태다.
  it('before_data 가 없으면 기준일 이전 마지막 after_data 를 쓴다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-05-23T10:00:00', action: 'CREATE',
            after_data: { id: 'r1', start_date: '2026-05-23', maturity: '2026-08-21', amount: 2_000_000 } }),
      log({ created_at: '2026-08-21T11:49:00', action: 'UPDATE', before_data: null,
            after_data: { id: 'r1', start_date: '2026-08-21', maturity: '2026-11-23', amount: 2_000_000 } }),
    ], '2026-06-25')
    expect(snaps.get('r1')).toMatchObject({ start_date: '2026-05-23', maturity: '2026-08-21' })
  })

  it('before_data 가 있으면 그쪽을 우선한다 — 더 정확하다', () => {
    const snaps = buildAsOfSnapshots([
      log({ created_at: '2026-05-23T10:00:00', after_data:  { id: 'r1', amount: 111 } }),
      log({ created_at: '2026-08-21T11:49:00', before_data: { id: 'r1', amount: 222 } }),
    ], '2026-06-25')
    expect(snaps.get('r1')).toEqual({ id: 'r1', amount: 222 })
  })
})

describe('applyAsOf', () => {
  interface Rec { id: string; start: string; amount: number }
  const fromDb = (row: Record<string, unknown>): Rec => ({
    id: row.id as string,
    // DB 행은 snake_case — 반드시 매핑을 거쳐야 개시일이 살아난다
    start: (row.start_date as string) ?? '',
    amount: (row.amount as number) ?? 0,
  })

  it('스냅샷이 있는 건만 교체한다', () => {
    const cur: Rec[] = [
      { id: 'r1', start: '2026-08-21', amount: 2_000_000 },
      { id: 'r2', start: '2026-01-01', amount: 500 },
    ]
    const snaps = new Map([['r1', { id: 'r1', start_date: '2026-05-23', amount: 2_000_000 }]])
    const { records, restoredIds } = applyAsOf(cur, snaps, fromDb)
    expect(records[0].start).toBe('2026-05-23')   // 연장 전 개시일로 복원
    expect(records[1].start).toBe('2026-01-01')   // 손대지 않음
    expect([...restoredIds]).toEqual(['r1'])
  })

  it('스냅샷이 깨져 있으면 현재 값을 유지한다 — 복원 실패로 데이터를 잃지 않는다', () => {
    const cur: Rec[] = [{ id: 'r1', start: '2026-08-21', amount: 100 }]
    const snaps = new Map([['r1', null as unknown as Record<string, unknown>]])
    const { records, restoredIds } = applyAsOf(cur, snaps, fromDb)
    expect(records[0].start).toBe('2026-08-21')
    expect(restoredIds.size).toBe(0)
  })
})
