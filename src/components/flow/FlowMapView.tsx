/**
 * 자금 이동 지도 (2026-09-11, Phase 3)
 *
 * "줄어든 게 아니라 옮겨간 것"을 한눈에 보이게 한다.
 * 운전 ↔ 운용 내부 이동과 경계를 넘은 유입·유출을 같은 그림에 놓는다.
 *
 * ⚠ 미설명 몫도 노드로 그린다 — 숨기면 "모든 흐름이 설명됐다"고 그림이 거짓말한다.
 */
import { ResponsiveContainer, Sankey, Tooltip, Layer, Rectangle } from 'recharts'
import { fmtKRW } from '../../lib/format'
import { buildSankey } from '../../lib/flowSankey'
import type { FlowBridge } from '../../lib/flowBridge'

/** 노드 성격별 색 — 유입(초록) / 보유(파랑) / 유출(빨강) / 미설명(회색) */
const NODE_TONE: Record<string, string> = {
  '영업 유입':      '#10b981',
  '차입':           '#10b981',
  '자산 처분':      '#10b981',
  '미설명 유입':    '#9ca3af',
  '운전자금':       '#2563eb',
  '가용 운용자금':  '#6366f1',
  '영업 유출':      '#ef4444',
  '차입 상환':      '#ef4444',
  '자산 취득':      '#ef4444',
  '미설명 유출':    '#9ca3af',
}

interface NodeProps {
  x: number; y: number; width: number; height: number; index: number
  payload: { name: string; value: number }
}

function SankeyNode({ x, y, width, height, payload }: NodeProps) {
  const color = NODE_TONE[payload.name] ?? '#94a3b8'
  // 왼쪽 절반에 있는 노드는 라벨을 오른쪽에, 오른쪽 노드는 왼쪽에 둔다
  const isLeft = x < 200
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} radius={2} />
      <text
        x={isLeft ? x + width + 6 : x - 6}
        y={y + height / 2}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={11}
        className="fill-gray-700 dark:fill-slate-200"
      >
        {payload.name}
      </text>
      <text
        x={isLeft ? x + width + 6 : x - 6}
        y={y + height / 2 + 13}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={10}
        className="fill-gray-400 dark:fill-slate-500"
      >
        {fmtKRW(payload.value)}
      </text>
    </Layer>
  )
}

export default function FlowMapView({ bridge }: { bridge: FlowBridge | null }) {
  if (!bridge) return null
  const data = buildSankey(bridge)

  if (!data.hasFlow) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-10 text-center text-sm text-gray-400">
        이 기간에 그릴 자금 이동이 없습니다.
      </div>
    )
  }

  const internalOut = bridge.groups.internal.outKrw
  const internalIn  = bridge.groups.internal.inKrw

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-100 mb-1">자금이 어디서 와서 어디로 갔나</h3>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-3">
          가운데 <strong>운전자금</strong>을 모든 현금이 지나갑니다. 운전 ↔ 운용 사이 화살표는
          <strong> 회사 밖으로 나간 돈이 아니라 옮겨간 돈</strong>입니다 — 합계는 변하지 않습니다.
        </p>

        <div style={{ width: '100%', height: 380 }}>
          <ResponsiveContainer>
            <Sankey
              data={data}
              nodePadding={26}
              nodeWidth={12}
              margin={{ top: 10, right: 120, bottom: 10, left: 90 }}
              link={{ stroke: '#94a3b8', strokeOpacity: 0.25 }}
              node={<SankeyNode x={0} y={0} width={0} height={0} index={0} payload={{ name: '', value: 0 }} />}
            >
              <Tooltip
                formatter={(v) => fmtKRW(Number(v ?? 0))}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">내부 이동 (합계 불변)</p>
          <div className="space-y-1 text-xs tabular-nums text-gray-600 dark:text-slate-300">
            <div className="flex justify-between"><span>운전 → 운용 (집행)</span><span>{fmtKRW(internalOut)}</span></div>
            <div className="flex justify-between"><span>운용 → 운전 (회수)</span><span>{fmtKRW(internalIn)}</span></div>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5">
            이 금액은 회사가 가진 돈의 총량을 바꾸지 않습니다.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">그림의 한계</p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
            자금일보에 입출금 항목이 없는 날의 증감은 <strong>미설명</strong> 노드로 들어갑니다.
            그 폭이 크면 이 그림만으로 자금 흐름을 판단하기 어렵습니다 —
            상단 설명률({Math.round(bridge.coverage * 100)}%)을 함께 보세요.
          </p>
        </div>
      </div>
    </div>
  )
}
