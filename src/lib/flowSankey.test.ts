import { describe, it, expect } from 'vitest'
import { buildSankey } from './flowSankey'
import type { FlowBridge } from './flowBridge'

const EMPTY = { inKrw: 0, outKrw: 0, net: 0, count: 0 }

function bridge(p: Partial<FlowBridge['groups']> = {}, lanes: Partial<FlowBridge['lanes']> = {}): FlowBridge {
  return {
    from: '2026-01-01', to: '2026-01-31',
    opening: { operatingKrw: 0, investKrw: 0, total: 0 },
    closing: { operatingKrw: 0, investKrw: 0, total: 0 },
    observed: 0, explained: 0, unexplained: 0, fxEffect: null,
    groups: {
      operating: EMPTY, financing: EMPTY, external: EMPTY,
      internal: EMPTY, excluded: EMPTY, unknown: EMPTY, ...p,
    },
    categories: [], coverage: 1,
    lanes: {
      opDelta: 0, opExplained: 0, opUnexplained: 0,
      investDelta: 0, investExplained: 0, investAdjust: 0,
      bondDelta: 0, lockedDelta: 0, ...lanes,
    },
    openingFull: 0, closingFull: 0,
    openingBreakdown: { availKrw: 0, bondAvailKrw: 0, bondLockedKrw: 0, lockedKrw: 0, bondKrw: 0, allKrw: 0 },
    closingBreakdown: { availKrw: 0, bondAvailKrw: 0, bondLockedKrw: 0, lockedKrw: 0, bondKrw: 0, allKrw: 0 },
  }
}

describe('buildSankey', () => {
  it('흐름이 없으면 hasFlow=false — 빈 그림 대신 안내를 띄우게 한다', () => {
    expect(buildSankey(bridge()).hasFlow).toBe(false)
  })

  it('유입·유출을 각각 양수 폭으로 그린다 — Sankey 는 음수를 표현하지 못한다', () => {
    const s = buildSankey(bridge({
      operating: { inKrw: 300, outKrw: 100, net: 200, count: 2 },
    }))
    const values = s.links.map(l => l.value)
    expect(values.every(v => v > 0)).toBe(true)
    expect(s.links).toContainEqual({ source: 0, target: 4, value: 300 })  // 영업 유입 → 운전
    expect(s.links).toContainEqual({ source: 4, target: 6, value: 100 })  // 운전 → 영업 유출
  })

  // "줄어든 게 아니라 옮겨간 것"을 보여주는 것이 이 그림의 목적이다.
  it('운전 ↔ 운용 내부 이동을 양방향으로 그린다', () => {
    const s = buildSankey(bridge({
      internal: { inKrw: 50, outKrw: 800, net: -750, count: 3 },
    }))
    expect(s.links).toContainEqual({ source: 4, target: 5, value: 800 })  // 운전 → 운용
    expect(s.links).toContainEqual({ source: 5, target: 4, value: 50 })   // 운용 → 운전
  })

  // ⚠ 미설명을 숨기면 그림이 "모든 흐름이 설명됐다"고 거짓말한다.
  it('미설명도 노드로 그린다 — 부호에 따라 유입/유출 쪽에', () => {
    const plus = buildSankey(bridge({}, { opUnexplained: 500 }))
    expect(plus.links).toContainEqual({ source: 3, target: 4, value: 500 })

    const minus = buildSankey(bridge({}, { opUnexplained: -500 }))
    expect(minus.links).toContainEqual({ source: 4, target: 9, value: 500 })
  })

  it('1원 미만 흐름은 그리지 않는다 — Sankey 가 0 폭 링크를 렌더하지 못한다', () => {
    const s = buildSankey(bridge({
      operating: { inKrw: 0.4, outKrw: 0, net: 0.4, count: 1 },
    }))
    expect(s.hasFlow).toBe(false)
  })

  it('노드 인덱스는 고정이다 — 재정렬하면 링크가 어긋난다', () => {
    const s = buildSankey(bridge({ operating: { inKrw: 10, outKrw: 0, net: 10, count: 1 } }))
    expect(s.nodes[4].name).toBe('운전자금')
    expect(s.nodes[5].name).toBe('가용 운용자금')
  })
})
