import { describe, it, expect } from 'vitest'
import {
  REGIME_SNAPSHOT_KEYS, readRegimeSnapshot, syncRegimeSnapshot, pendingDays,
  type RegimeSnapshotHistoryEntry,
} from './fxRegimeSnapshot'

/** policy_params 를 흉내내는 메모리 스토어 */
function makeStore(initial: Record<string, { v: number | null; t: string | null }> = {}) {
  const rows = { ...initial }
  return {
    rows,
    get: (k: string) => rows[k]?.v ?? null,
    getText: (k: string) => rows[k]?.t ?? null,
    set: async (k: string, v: number | null, t: string | null) => {
      rows[k] = { v, t }
      return null
    },
  }
}

const CUR = 'USD'
const K = {
  target:  REGIME_SNAPSHOT_KEYS.targetPct(CUR),
  current: REGIME_SNAPSHOT_KEYS.currentPct(CUR),
  suggest: REGIME_SNAPSHOT_KEYS.suggestKRW(CUR),
  since:   REGIME_SNAPSHOT_KEYS.since(CUR),
  asOf:    REGIME_SNAPSHOT_KEYS.asOf(CUR),
}

describe('fxRegimeSnapshot', () => {
  it('판정한 적이 없으면 null 을 반환한다 (오탐 방지)', () => {
    expect(readRegimeSnapshot(makeStore(), CUR)).toBeNull()
  })

  it('권고가 처음 발생하면 since 를 오늘로 찍는다', async () => {
    const store = makeStore()
    await syncRegimeSnapshot(store, CUR,
      { targetPct: 20, currentPct: 28.4, suggestKRW: 1_000_000_000, asOf: '2026-08-14' },
      '2026-08-14', 'tester')

    const snap = readRegimeSnapshot(store, CUR)
    expect(snap?.since).toBe('2026-08-14')
    expect(snap?.suggestKRW).toBe(1_000_000_000)
    expect(snap?.targetPct).toBe(20)
  })

  it('권고가 이어지면 since 를 갱신하지 않는다 — 경과일이 리셋되면 안 된다', async () => {
    const store = makeStore({
      [K.target]:  { v: 20, t: null },
      [K.current]: { v: 28.4, t: null },
      [K.suggest]: { v: 1_000_000_000, t: null },
      [K.since]:   { v: null, t: '2026-08-10' },
      [K.asOf]:    { v: null, t: '2026-08-13' },
    })
    await syncRegimeSnapshot(store, CUR,
      { targetPct: 20, currentPct: 27.9, suggestKRW: 900_000_000, asOf: '2026-08-14' },
      '2026-08-14', 'tester')

    expect(readRegimeSnapshot(store, CUR)?.since).toBe('2026-08-10')
  })

  it('조치 불필요로 돌아가면 since 를 지운다', async () => {
    const store = makeStore({
      [K.target]:  { v: 20, t: null },
      [K.current]: { v: 28.4, t: null },
      [K.suggest]: { v: 1_000_000_000, t: null },
      [K.since]:   { v: null, t: '2026-08-10' },
      [K.asOf]:    { v: null, t: '2026-08-13' },
    })
    await syncRegimeSnapshot(store, CUR,
      { targetPct: 30, currentPct: 27.9, suggestKRW: 0, asOf: '2026-08-14' },
      '2026-08-14', 'tester')

    const snap = readRegimeSnapshot(store, CUR)
    expect(snap?.since).toBeNull()
    expect(snap?.suggestKRW).toBe(0)
  })

  it('변경이 없으면 아무것도 쓰지 않는다', async () => {
    const store = makeStore({
      [K.target]:  { v: 20, t: null },
      [K.current]: { v: 28.4, t: null },
      [K.suggest]: { v: 1_000_000_000, t: null },
      [K.since]:   { v: null, t: '2026-08-10' },
      [K.asOf]:    { v: null, t: '2026-08-14' },
    })
    const written = await syncRegimeSnapshot(store, CUR,
      { targetPct: 20, currentPct: 28.4, suggestKRW: 1_000_000_000, asOf: '2026-08-14' },
      '2026-08-14', 'tester')

    expect(written).toBe(0)
  })

  it('판정 근거를 이력에 그대로 전달한다', async () => {
    const store = makeStore({})
    const entries: RegimeSnapshotHistoryEntry[] = []
    await syncRegimeSnapshot(store, CUR,
      {
        targetPct: 26.7, currentPct: 29.8, suggestKRW: 2_760_000_000, asOf: '2026-09-29',
        regimeCode: '5-B', levelGrade: 'H', trendGroup: 'down',
        rawTargetPct: 15, clampedBy: 'policy_band',
      },
      '2026-09-29', 'tester', async e => { entries.push(e) })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      regimeCode: '5-B', levelGrade: 'H', trendGroup: 'down',
      rawTargetPct: 15, clampedBy: 'policy_band',
      targetPct: 26.7, sinceDate: '2026-09-29',
    })
  })

  it('근거를 넘기지 않으면 null 로 기록한다 (앵커 미설정·구 호출부)', async () => {
    const store = makeStore({})
    const entries: RegimeSnapshotHistoryEntry[] = []
    await syncRegimeSnapshot(store, CUR,
      { targetPct: 30, currentPct: 29, suggestKRW: 0, asOf: '2026-09-29' },
      '2026-09-29', 'tester', async e => { entries.push(e) })

    expect(entries[0].regimeCode).toBeNull()
    expect(entries[0].levelGrade).toBeNull()
    expect(entries[0].clampedBy).toBeNull()
  })

  it('pendingDays — 권고가 없거나 기산점이 없으면 null', () => {
    const bd = (a: string, b: string) => (a === b ? 0 : 3)
    expect(pendingDays(null, '2026-08-14', bd)).toBeNull()
    expect(pendingDays(
      { currency: CUR, targetPct: 20, currentPct: 28, suggestKRW: 0, since: '2026-08-10', asOf: '2026-08-14' },
      '2026-08-14', bd)).toBeNull()
    expect(pendingDays(
      { currency: CUR, targetPct: 20, currentPct: 28, suggestKRW: 100, since: null, asOf: '2026-08-14' },
      '2026-08-14', bd)).toBeNull()
    expect(pendingDays(
      { currency: CUR, targetPct: 20, currentPct: 28, suggestKRW: 100, since: '2026-08-10', asOf: '2026-08-14' },
      '2026-08-14', bd)).toBe(3)
  })
})
