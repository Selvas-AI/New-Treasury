/**
 * 자금 이동 지도 데이터 구성 (2026-09-11, Phase 3)
 *
 * "줄어든 게 아니라 옮겨간 것"을 한눈에 보이게 한다.
 * 운전 ↔ 운용 내부 이동과, 경계를 넘은 유입·유출을 같은 그림에 놓는다.
 *
 * ⚠ Sankey 는 **모든 흐름이 설명된 것처럼** 보이게 만드는 그림이다.
 *   이 시스템은 자금일보 항목이 비는 날이 많아 미설명 차액이 크다.
 *   그래서 미설명도 **노드로 그린다.** 숨기면 그림이 거짓말을 한다.
 *
 * ⚠ Sankey 는 음수 흐름을 표현하지 못한다. 순액이 아니라 **유입/유출을 각각
 *   양수 폭으로** 그리고, 방향은 노드 배치로 나타낸다.
 */
import type { FlowBridge } from './flowBridge'

export interface SankeyNode { name: string }
export interface SankeyLink { source: number; target: number; value: number }
export interface SankeyData {
  nodes: SankeyNode[]
  links: SankeyLink[]
  /** 그릴 흐름이 없으면 false — 호출부가 안내 문구로 대체한다 */
  hasFlow: boolean
}

/** Sankey 는 0 이하 값을 렌더하지 못한다 */
const MIN = 1

export function buildSankey(bridge: FlowBridge): SankeyData {
  const g = bridge.groups

  // 유입 측 — 경계를 넘어 들어온 돈
  const opIn   = g.operating.inKrw
  const finIn  = g.financing.inKrw
  const extIn  = g.external.inKrw
  // 유출 측 — 경계를 넘어 나간 돈
  const opOut  = g.operating.outKrw
  const finOut = g.financing.outKrw
  const extOut = g.external.outKrw
  // 내부 이동 — 운전 ↔ 운용 (합계는 변하지 않는다)
  const toInvest   = g.internal.outKrw
  const fromInvest = g.internal.inKrw
  // 설명되지 않은 몫
  const unexIn  = bridge.lanes.opUnexplained > 0 ?  bridge.lanes.opUnexplained : 0
  const unexOut = bridge.lanes.opUnexplained < 0 ? -bridge.lanes.opUnexplained : 0

  const nodes: SankeyNode[] = [
    { name: '영업 유입' },      // 0
    { name: '차입' },           // 1
    { name: '자산 처분' },      // 2
    { name: '미설명 유입' },    // 3
    { name: '운전자금' },       // 4  ← 모든 현금이 지나는 지점
    { name: '가용 운용자금' },  // 5
    { name: '영업 유출' },      // 6
    { name: '차입 상환' },      // 7
    { name: '자산 취득' },      // 8
    { name: '미설명 유출' },    // 9
  ]

  const raw: [number, number, number][] = [
    [0, 4, opIn],
    [1, 4, finIn],
    [2, 4, extIn],
    [3, 4, unexIn],
    [4, 5, toInvest],      // 운전 → 운용 (내부 이동)
    [5, 4, fromInvest],    // 운용 → 운전 (회수)
    [4, 6, opOut],
    [4, 7, finOut],
    [4, 8, extOut],
    [4, 9, unexOut],
  ]

  const links = raw
    .filter(([, , v]) => v >= MIN)
    .map(([source, target, value]) => ({ source, target, value: Math.round(value) }))

  // 쓰이지 않은 노드는 남겨도 무해하다(Recharts 가 0 폭으로 그리지 않는다).
  // 노드 인덱스를 재정렬하면 링크가 어긋나므로 건드리지 않는다.
  return { nodes, links, hasFlow: links.length > 0 }
}
