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

// ── 바구니 스냅샷 1건 + 신선도 (2026-11-25 전수조사 F-05) ─────────────────────
import { readBasketSnapshot, BASKET_SNAPSHOT_CURRENCY } from './fxRegimeSnapshot'

describe('readBasketSnapshot — 바구니 1건 + 신선도', () => {
  const store = (asOf: string | null, extra: Record<string, number | string> = {}) => {
    const num: Record<string, number> = {}
    const txt: Record<string, string> = {}
    const c = BASKET_SNAPSHOT_CURRENCY
    if (asOf) txt[REGIME_SNAPSHOT_KEYS.asOf(c)] = asOf
    num[REGIME_SNAPSHOT_KEYS.suggestKRW(c)] = 3_000_000_000
    txt[REGIME_SNAPSHOT_KEYS.lead(c)] = 'USD'
    for (const [k, v] of Object.entries(extra)) (typeof v === 'number' ? num : txt)[k] = v as never
    return { get: (k: string) => num[k] ?? null, getText: (k: string) => txt[k] ?? null }
  }
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

  it('기록이 없으면 null', () => {
    expect(readBasketSnapshot(store(null), '2026-11-25', days)).toBeNull()
  })
  it('대표 통화를 함께 읽는다', () => {
    expect(readBasketSnapshot(store('2026-11-24'), '2026-11-25', days)?.lead).toBe('USD')
  })
  it('10영업일 이내면 fresh', () => {
    expect(readBasketSnapshot(store('2026-11-20'), '2026-11-25', days)?.fresh).toBe(true)
  })
  it('10영업일을 넘기면 fresh=false — 미이행 경보 대신 "판정 갱신 필요"', () => {
    const s = readBasketSnapshot(store('2026-10-01'), '2026-11-25', days)
    expect(s?.fresh).toBe(false)
    expect(s?.ageBizDays).toBeGreaterThan(10)
  })
  it('구 통화별 키(USD)는 읽지 않는다', () => {
    const legacy = { get: () => null, getText: (k: string) => (k === REGIME_SNAPSHOT_KEYS.asOf('usd') ? '2026-11-24' : null) }
    expect(readBasketSnapshot(legacy, '2026-11-25', days)).toBeNull()
  })
})
