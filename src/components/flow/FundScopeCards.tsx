/**
 * 기초 잔액 / 기간 증감 / 기말 잔액 — 가용·불가용 구분 (2026-09-09)
 *
 * ⭐ 불가용에는 장기·초장기·실현 불가 자산이 섞여 있다. 총액만 보면
 *   당장 쓸 수 있는 돈이 훨씬 많은 것처럼 왜곡된다(사용자 지적).
 *   그래서 세 지점(기초·증감·기말) **모두** 가용/불가용을 나눠 보여준다.
 *
 * ⚠ 차입금은 넣지 않는다(2026-09-09 사용자 결정) — 회사가 활용할 수 있는 자금이 아니다.
 *   그래서 자금 변동 이력의 '순현금 포지션'과는 정의가 다르다. 그 화면과 대조할 때는
 *   운전자금·운용자금 열을 보면 된다.
 *
 * 가용·불가용 줄을 클릭하면 그 금액이 어떤 건으로 이뤄졌는지 펼쳐진다 —
 * "이게 왜 불가용이지?" 를 화면에서 바로 확인할 수 있어야 한다.
 */
import { useState } from 'react'
import { fmtKRW } from '../../lib/format'
import type { FundScope, InvestBreakdown, InvestItem } from '../../lib/flowBridge'

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmtKRW(Math.abs(n))}`
const toneOf = (n: number) =>
  n > 0 ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'

export interface FundScopeSnapshot {
  date: string
  scope: FundScope
  breakdown: InvestBreakdown
  items: InvestItem[]
}

export default function FundScopeCards({ opening, closing }: {
  opening: FundScopeSnapshot | null
  closing: FundScopeSnapshot | null
}) {
  if (!opening || !closing) return null

  const d = {
    avail:  closing.scope.availableKrw - opening.scope.availableKrw,
    locked: closing.scope.lockedKrw    - opening.scope.lockedKrw,
    total:  closing.scope.totalKrw     - opening.scope.totalKrw,
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <BalancePanel title="기초 잔액" snap={opening} />

      {/* 기간 증감 — 관측된 사실 */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="flex items-baseline justify-between mb-2.5">
          <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">기간 증감</span>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">관측된 사실</span>
        </div>
        <Line label="가용"   value={d.avail}  delta accent />
        <Line label="불가용" value={d.locked} delta />
        <Total label="합계" value={d.total} delta />
      </div>

      <BalancePanel title="기말 잔액" snap={closing} />
    </div>
  )
}

function BalancePanel({ title, snap }: { title: string; snap: FundScopeSnapshot }) {
  const { scope, breakdown, items, date } = snap
  const availItems  = items.filter(i => i.available === '가용')
  const lockedItems = items.filter(i => i.available !== '가용')

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">{title}</span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500 tabular-nums">{date}</span>
      </div>

      <Line label="가용" value={scope.availableKrw} accent
        detail={[
          ['운전자금',      scope.operatingKrw],
          ['가용 운용자금', breakdown.availKrw],
          ['가용 국채',     breakdown.bondAvailKrw],
        ]}
        items={availItems} />

      <Line label="불가용" value={scope.lockedKrw}
        detail={[
          ['불가용 운용자금', breakdown.lockedKrw],
          ['불가용 국채',     breakdown.bondLockedKrw],
        ]}
        items={lockedItems} />

      <Total label="합계" value={scope.totalKrw} />
    </div>
  )
}

function Line({ label, value, detail, items, accent, delta, negative }: {
  label: string
  value: number
  detail?: [string, number][]
  items?: InvestItem[]
  accent?: boolean
  delta?: boolean
  negative?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rows = (detail ?? []).filter(([, v]) => v !== 0)
  const canExpand = !!items?.length

  return (
    <div className="mb-2">
      <div
        className={`flex items-baseline justify-between ${canExpand ? 'cursor-pointer' : ''}`}
        onClick={canExpand ? () => setOpen(o => !o) : undefined}
        title={canExpand ? '구성 건 보기' : undefined}
      >
        <span className={`text-[11px] ${
          accent ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}>
          {canExpand && <span className="text-gray-400 mr-0.5">{open ? '▾' : '▸'}</span>}
          {label}
        </span>
        <span className={`text-lg font-bold tabular-nums ${
          delta ? toneOf(negative ? -value : value)
                : accent ? 'text-blue-800 dark:text-blue-200'
                : negative ? 'text-gray-500 dark:text-slate-400'
                : 'text-gray-700 dark:text-slate-200'}`}>
          {delta
            ? (value === 0 ? '—' : signed(value))
            : (negative ? `−${fmtKRW(value)}` : fmtKRW(value))}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {rows.map(([l, v]) => (
            <div key={l} className="flex justify-between text-[10px] tabular-nums text-gray-400 dark:text-slate-500">
              <span>{l}</span><span>{fmtKRW(v)}</span>
            </div>
          ))}
        </div>
      )}

      {open && items && (
        <div className="mt-1 pl-2 border-l-2 border-gray-100 dark:border-slate-700 space-y-0.5">
          {items.map(i => (
            <div key={i.id} className="flex justify-between gap-2 text-[10px] text-gray-500 dark:text-slate-400">
              <span className="truncate">
                {i.label}
                {i.currency !== 'KRW' && (
                  <span className="ml-1 text-blue-500 dark:text-blue-400">{i.currency}</span>
                )}
                {i.isBond && <span className="ml-1 text-gray-400">국채</span>}
                {i.restored && (
                  <span className="ml-1 text-blue-600 dark:text-blue-400"
                    title="연장 등으로 레코드가 수정된 건입니다. 변경 이력에서 그 시점 상태를 복원했습니다.">
                    이력복원
                  </span>
                )}
                {i.inferred && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400"
                    title={`종료일 기록이 없어 만기일(${i.maturity})로 개시 여부를 추정했습니다`}>
                    만기추정
                  </span>
                )}
              </span>
              <span className="tabular-nums shrink-0">{fmtKRW(i.amountKrw)}</span>
            </div>
          ))}
          {!items.length && <div className="text-[10px] text-gray-400">해당 건이 없습니다.</div>}
        </div>
      )}
    </div>
  )
}

function Total({ label, value, delta }: { label: string; value: number; delta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
      <span className="text-[11px] text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${
        delta ? toneOf(value) : 'text-gray-600 dark:text-slate-300'}`}>
        {delta ? (value === 0 ? '—' : signed(value)) : fmtKRW(value)}
      </span>
    </div>
  )
}
