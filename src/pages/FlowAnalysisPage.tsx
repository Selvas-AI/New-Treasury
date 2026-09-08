/**
 * 자금흐름 분석 (2026-09-08, Phase 1)
 *
 * 가용운전 + 가용운용이 기간 동안 어떻게 지금이 되었는지를 분해해 보여준다.
 * ⚠ 읽기 전용 화면이다 — 어떤 데이터도 쓰지 않는다. 이상을 발견하면 원천 화면으로 이동만 한다.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageCompany } from '../hooks/usePageCompany'
import { useFlowBridge, type FlowRow } from '../hooks/useFlowBridge'
import { FLOW_GROUP_LABEL, type FlowGroup } from '../lib/flowBridge'
import { IN_CATEGORIES, OUT_CATEGORIES } from '../lib/dailyReportCategories'
import { fmtKRW } from '../lib/format'
import { NotionTable, type ColumnDef } from '../components/common/NotionTable'

const CAT_LABEL: Record<string, string> = Object.fromEntries(
  [...IN_CATEGORIES, ...OUT_CATEGORIES].map(c => [c.code, c.label]),
)

const GROUP_TONE: Record<FlowGroup, string> = {
  operating: 'text-blue-600 dark:text-blue-400',
  financing: 'text-purple-600 dark:text-purple-400',
  external:  'text-orange-600 dark:text-orange-400',
  internal:  'text-gray-500 dark:text-slate-400',
  excluded:  'text-gray-400 dark:text-slate-500',
  unknown:   'text-amber-600 dark:text-amber-400',
}

/** 기본 조회 구간 — 이번 달 1일부터 오늘까지 */
function defaultRange(): { from: string; to: string } {
  const today = new Date()
  const to = today.toISOString().slice(0, 10)
  const from = `${to.slice(0, 8)}01`
  return { from, to }
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmtKRW(Math.abs(n))}`
const toneOf = (n: number) =>
  n > 0 ? 'text-emerald-600 dark:text-emerald-400'
        : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'

type Tab = 'bridge' | 'breakdown' | 'ledger'

export default function FlowAnalysisPage() {
  const { company } = usePageCompany('/flow-analysis')
  const init = useMemo(defaultRange, [])
  const [from, setFrom] = useState(init.from)
  const [to,   setTo]   = useState(init.to)
  const [tab,  setTab]  = useState<Tab>('bridge')

  const { loading, error, bridge, rows, dailyDays, reportDays } = useFlowBridge(company, from, to)

  return (
    <div className="space-y-4">
      {/* ── 조회 조건 ─────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">시작일</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">종료일</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100" />
          </div>
          <div className="flex gap-1.5">
            {([['최근 1개월', 1], ['3개월', 3], ['6개월', 6]] as const).map(([label, months]) => (
              <button key={label} onClick={() => {
                const d = new Date(); const toS = d.toISOString().slice(0, 10)
                d.setMonth(d.getMonth() - months)
                setFrom(d.toISOString().slice(0, 10)); setTo(toS)
              }}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto text-xs text-gray-400 dark:text-slate-500">
            {company} · 임시 입력 포함
          </div>
        </div>

        {/* 설명률 — 이 분석의 신뢰도. 항상 보인다. */}
        {bridge && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className={bridge.coverage >= 0.9
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : 'text-amber-600 dark:text-amber-400 font-semibold'}>
              설명률 {(bridge.coverage * 100).toFixed(0)}%
            </span>
            <span className="text-gray-500 dark:text-slate-400">
              미설명 차액 {signed(bridge.unexplained)}
            </span>
            <span className="text-gray-400 dark:text-slate-500">
              잔액 {dailyDays}일 · 항목이 있는 일보 {reportDays}건
            </span>
            {bridge.coverage < 0.9 && (
              <span className="text-gray-400 dark:text-slate-500">
                — 일보 미작성일의 증감은 항목으로 설명되지 않습니다
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 탭 ────────────────────────────────────────────── */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
        {([['bridge', '📊 브릿지'], ['breakdown', '🔍 순유출 분해'], ['ledger', '📄 원장']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === k ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-400 py-10 text-center">불러오는 중…</div>}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {!loading && !error && !bridge && (
        <div className="text-sm text-gray-400 py-10 text-center">
          이 기간에 운전자금 잔액 데이터가 없습니다.
        </div>
      )}

      {!loading && bridge && tab === 'bridge'    && <BridgeView bridge={bridge} company={company} />}
      {!loading && bridge && tab === 'breakdown' && <BreakdownView bridge={bridge} />}
      {!loading && bridge && tab === 'ledger'    && <LedgerView rows={rows} />}
    </div>
  )
}

// ── VIEW 1 · 브릿지 ────────────────────────────────────────────
function BridgeView({ bridge, company }: { bridge: ReturnType<typeof useFlowBridge>['bridge'] & object; company: string }) {
  const steps = [
    { key: 'operating' as const, label: '영업활동', net: bridge.groups.operating.net },
    { key: 'external'  as const, label: '범위 밖 자산', net: bridge.groups.external.net },
    { key: 'financing' as const, label: '재무활동', net: bridge.groups.financing.net },
    { key: 'unknown'   as const, label: '분류 불가', net: 0, raw: bridge.groups.unknown },
    { key: 'unexplained' as const, label: '미설명', net: bridge.unexplained },
  ]

  return (
    <div className="space-y-4">
      {/* 기초 → 기말 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel title="기초 잔액" sub={bridge.from}>
          <Big value={bridge.opening.total} />
          <Split a={bridge.opening.operatingKrw} b={bridge.opening.investKrw} />
        </Panel>
        <Panel title="기간 증감" sub="관측된 사실">
          <div className={`text-2xl font-bold tabular-nums ${toneOf(bridge.observed)}`}>
            {signed(bridge.observed)}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
            기말 − 기초
          </p>
        </Panel>
        <Panel title="기말 잔액" sub={bridge.to}>
          <Big value={bridge.closing.total} />
          <Split a={bridge.closing.operatingKrw} b={bridge.closing.investKrw} />
        </Panel>
      </div>

      {/* 분해 막대 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-100 mb-1">
          이 증감은 무엇으로 설명되는가
        </h3>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-4">
          운전 ↔ 운용 사이의 이동은 합계를 바꾸지 않으므로 아래 막대에 넣지 않습니다.
        </p>

        <div className="space-y-2.5">
          {steps.filter(s => s.key !== 'unknown').map(s => (
            <BarRow key={s.key} label={s.label} value={s.net}
              max={Math.max(...steps.map(x => Math.abs(x.net)), 1)}
              muted={s.key === 'unexplained'} />
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
          <span className="text-gray-500 dark:text-slate-400">
            내부이동 <span className="tabular-nums font-medium">{fmtKRW(bridge.groups.internal.outKrw)}</span>
            <span className="text-gray-400"> (운전 ↔ 운용 · 합계 불변)</span>
          </span>
          {bridge.groups.unknown.count > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              분류 불가 {bridge.groups.unknown.count}건 — 연동 정보가 없어 경계 판정이 안 됩니다
            </span>
          )}
          {bridge.groups.excluded.count > 0 && (
            <span className="text-gray-400 dark:text-slate-500">
              평가손익 자동기재 {bridge.groups.excluded.count}건 제외 (현금 이동 없음)
            </span>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        환율효과는 아직 분리되지 않아 미설명 차액에 포함돼 있습니다(Phase 2).
        원천 데이터 확인은 <Link to={`/daily-report-list/${company}`} className="text-blue-600 hover:underline">자금일보 목록</Link> ·
        <Link to={`/invest/${company}`} className="text-blue-600 hover:underline ml-1">운용자금</Link>에서.
      </p>
    </div>
  )
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-slate-300">{title}</span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500 tabular-nums">{sub}</span>
      </div>
      {children}
    </div>
  )
}

function Big({ value }: { value: number }) {
  return <div className="text-2xl font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtKRW(value)}</div>
}

function Split({ a, b }: { a: number; b: number }) {
  return (
    <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 tabular-nums">
      운전 {fmtKRW(a)} · 운용 {fmtKRW(b)}
    </p>
  )
}

function BarRow({ label, value, max, muted }: { label: string; value: number; max: number; muted?: boolean }) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100)
  const pos = value >= 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-gray-600 dark:text-slate-300">{label}</span>
      <div className="flex-1 h-5 relative bg-gray-100 dark:bg-slate-700/50 rounded">
        <div
          className={`absolute inset-y-0 rounded ${
            muted ? 'bg-gray-400 dark:bg-slate-500'
                  : pos ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%`, left: 0 }}
        />
      </div>
      <span className={`w-32 text-right text-xs font-semibold tabular-nums ${muted ? 'text-gray-500' : toneOf(value)}`}>
        {signed(value)}
      </span>
    </div>
  )
}

// ── VIEW 2 · 순유출 분해 ───────────────────────────────────────
function BreakdownView({ bridge }: { bridge: ReturnType<typeof useFlowBridge>['bridge'] & object }) {
  const cats = bridge.categories.filter(c => c.group !== 'excluded')
  const top = cats.filter(c => c.net < 0).slice(0, 3)
  const maxAbs = Math.max(...cats.map(c => Math.abs(c.net)), 1)

  return (
    <div className="space-y-4">
      {top.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-100 mb-2">가장 크게 자금을 끌어간 항목</h3>
          <ol className="space-y-1 text-sm">
            {top.map((c, i) => (
              <li key={c.category + c.group} className="flex items-baseline gap-2">
                <span className="text-xs text-gray-400 tabular-nums">{i + 1}</span>
                <span className="text-gray-700 dark:text-slate-200">{CAT_LABEL[c.category] ?? c.category}</span>
                <span className={`text-xs ${GROUP_TONE[c.group]}`}>{FLOW_GROUP_LABEL[c.group]}</span>
                <span className="ml-auto tabular-nums font-semibold text-red-600 dark:text-red-400">{signed(c.net)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-700/50 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-300">
              <th className="text-left px-4 py-2.5">항목</th>
              <th className="text-left px-4 py-2.5">성격</th>
              <th className="text-right px-4 py-2.5">입금</th>
              <th className="text-right px-4 py-2.5">출금</th>
              <th className="text-right px-4 py-2.5">순액</th>
              <th className="text-right px-4 py-2.5">건수</th>
              <th className="px-4 py-2.5 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.category + c.group} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-4 py-2 text-gray-700 dark:text-slate-200">{CAT_LABEL[c.category] ?? c.category}</td>
                <td className={`px-4 py-2 text-xs ${GROUP_TONE[c.group]}`}>{FLOW_GROUP_LABEL[c.group]}</td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {c.inKrw ? fmtKRW(c.inKrw) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                  {c.outKrw ? fmtKRW(c.outKrw) : '—'}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${toneOf(c.net)}`}>{signed(c.net)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-400">{c.count}</td>
                <td className="px-4 py-2">
                  <div className="h-2 bg-gray-100 dark:bg-slate-700 rounded overflow-hidden">
                    <div className={`h-full ${c.net >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${(Math.abs(c.net) / maxAbs) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {!cats.length && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                이 기간에 입출금 항목이 없습니다.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── VIEW 5 · 원장 드릴다운 ─────────────────────────────────────
function LedgerView({ rows }: { rows: FlowRow[] }) {
  const columns: ColumnDef<FlowRow, unknown>[] = [
    { accessorKey: 'date', header: '일자' },
    { id: 'category', header: '항목',
      accessorFn: r => CAT_LABEL[r.category] ?? r.category },
    { id: 'group', header: '성격',
      accessorFn: r => FLOW_GROUP_LABEL[r.group],
      cell: ({ row }) => (
        <span className={`text-xs ${GROUP_TONE[row.original.group]}`}>
          {FLOW_GROUP_LABEL[row.original.group]}
        </span>
      ) },
    { id: 'dir', header: '구분',
      accessorFn: r => (r.direction === 'in' ? '입금' : '출금'),
      cell: ({ row }) => (
        <span className={row.original.direction === 'in'
          ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {row.original.direction === 'in' ? '입금' : '출금'}
        </span>
      ) },
    { accessorKey: 'amountKrw', header: '금액(원화)',
      cell: ({ getValue }) => <span className="tabular-nums">{fmtKRW(getValue<number>())}</span> },
    { accessorKey: 'currency', header: '통화' },
    { accessorKey: 'memo', header: '메모',
      cell: ({ getValue }) => <span className="text-gray-500">{getValue<string>() ?? ''}</span> },
    { accessorKey: 'reportStatus', header: '일보 상태' },
  ]
  return (
    <NotionTable<FlowRow>
      tableId="flow_analysis_ledger"
      columns={columns}
      data={rows}
      emptyText="이 기간에 입출금 항목이 없습니다."
    />
  )
}
