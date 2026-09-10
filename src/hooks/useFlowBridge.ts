/**
 * 자금흐름 브릿지 데이터 훅 (2026-09-08, Phase 1)
 *
 * 대상: 가용운전 + 가용운용. 기간 [from, to] 의 기초·기말 잔액과 그 사이 입출금 항목을 모아
 * `buildBridge()` 로 분해한다. 계산 로직은 전부 `lib/flowBridge.ts` 에 있다 — 여기서 재계산하지 않는다.
 *
 * ⚠ 기초는 from **직전 영업일**의 잔액이다. from 당일 잔액을 기초로 쓰면 그날의 증감이 통째로 빠진다.
 *   daily 는 영업일마다 존재하므로, from 미만의 가장 최근 daily 행을 기초로 삼는다.
 *
 * ⚠ 임시 입력도 포함한다(2026-09-08 사용자 결정) — daily_reports.status 로 거르지 않는다.
 *   승인 전 일보의 항목도 실제 자금 흐름이므로 분석에서 빼면 설명률만 떨어진다.
 *
 * ⚠ 읽기 전용 훅이다. 이 화면은 어떤 데이터도 쓰지 않는다.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { restSelect } from '../lib/supabase'
import { toKRWAmount } from '../lib/treasuryCalc'
import { useFx } from './useFx'
import { investFromDb } from './useInvestments'
import { fetchRatesOnOrBefore } from './useFxHistory'
import { buildAsOfSnapshots, applyAsOf, type AuditLogRow } from '../lib/recordAsOf'
import {
  computeFxEffect, amountsOf, FX_CODES,
  type FxEffectResult, type FxRates,
} from '../lib/fxEffect'
import {
  buildBridge, scopeBalanceOn, classifyItem, excludedBalanceOn, investDeltas,
  buildDailyLedger, investBreakdownOn, fundScopeOf, investItemsOn,
  type FlowBridge, type FlowItemInput, type FlowGroup,
  type ExcludedBalance, type InvestDelta, type DailyLedgerRow,
} from '../lib/flowBridge'
import type { FundScopeSnapshot } from '../components/flow/FundScopeCards'
import type { DailyRecord, InvestmentRecord, LoanRecord } from '../types'

interface ReportRow { id: string; company: string; report_date: string; status: string }
interface ItemRow {
  id: string; report_id: string; direction: 'in' | 'out'; category: string
  amount: number; currency: string; amount_krw: number | null; memo: string | null
  linked_type: string | null; linked_id: string | null
}

/** 화면에 뿌릴 거래 단위 행 — 드릴다운 표(VIEW 5)가 그대로 쓴다 */
export interface FlowRow extends FlowItemInput {
  group: FlowGroup
  reportStatus: string
}

export interface UseFlowBridgeResult {
  loading: boolean
  error: string | null
  bridge: FlowBridge | null
  rows: FlowRow[]
  /** 대상에서 뺀 금액(국채·불가용) — 자금 변동 이력과의 차이를 설명하기 위한 표시용 */
  excludedOpening: ExcludedBalance | null
  excludedClosing: ExcludedBalance | null
  /** 운용자금 레코드에서 직접 도출한 개시·해지 (자금일보 항목에 없어도 잡힌다) */
  investFlows: { opened: InvestDelta[]; closed: InvestDelta[]; openedKrw: number; closedKrw: number; net: number } | null
  /** 일자별 증감 원장 — 잔액 입력 이력으로 맞춘다(항상 정확히 떨어진다) */
  ledger: DailyLedgerRow[]
  /** 환율효과 분해 (Phase 2) — 환율 이력이 없으면 null */
  fxEffect: FxEffectResult | null
  /** 가용/불가용 구분 — 실제 쓸 수 있는 돈 (기초·기말) */
  scopeOpening: FundScopeSnapshot | null
  scopeClosing: FundScopeSnapshot | null
  /** 기간 내 daily 행 수 / 항목이 있는 일보 수 — 설명률 해석용 */
  dailyDays: number
  reportDays: number
  refetch: () => void
}

export function useFlowBridge(
  company: string | null,
  from: string,
  to: string,
): UseFlowBridgeResult {
  const fx = useFx()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [dailies, setDailies] = useState<DailyRecord[]>([])
  const [openingDaily, setOpeningDaily] = useState<DailyRecord | null>(null)
  const [invests, setInvests] = useState<InvestmentRecord[]>([])
  const [loans, setLoans]     = useState<LoanRecord[]>([])
  // 감사 로그 — 연장 등으로 덮어써진 과거 상태를 복원하는 데 쓴다
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [items, setItems]     = useState<ItemRow[]>([])
  // 환율효과용 — 기초·기말 두 시점의 통화별 환율만 가져온다(전 구간 조회 아님)
  const [fxRates, setFxRates] = useState<{ open: FxRates; close: FxRates } | null>(null)
  const fetchIdRef = useRef(0)

  const fetchAll = useCallback(async () => {
    if (!company || !from || !to) return
    const myId = ++fetchIdRef.current
    setLoading(true); setError(null)
    try {
      // ① 기간 내 일별 잔액 + ② 기초(직전 영업일) 잔액
      const [inRange, before] = await Promise.all([
        restSelect<DailyRecord>('daily', {
          match: { company },
          filters: [`date=gte.${from}`, `date=lte.${to}`],
          order: 'date.asc', limit: 400,
        }),
        restSelect<DailyRecord>('daily', {
          match: { company },
          filters: [`date=lt.${from}`],
          order: 'date.desc', limit: 1,
        }),
      ])
      if (fetchIdRef.current !== myId) return
      if (inRange.error) throw new Error(inRange.error.message)

      // ③ 운용자금 — 시점 판정을 해야 하므로 활성 여부로 거르지 않고 전부 가져온다
      const invRes = await restSelect<Record<string, unknown>>('investments', {
        match: { company }, order: 'start_date.asc', limit: 500,
      })
      if (fetchIdRef.current !== myId) return
      if (invRes.error) throw new Error(invRes.error.message)

      // ③-2 차입금
      const loanRes = await restSelect<LoanRecord>('loans', {
        match: { company }, order: 'start_date.asc', limit: 500,
      })
      if (fetchIdRef.current !== myId) return
      if (loanRes.error) throw new Error(loanRes.error.message)

      // ③-3 운용자금 변경 이력 — 정기예금을 연장할 때 기존 레코드의 개시일·만기일을
      //     덮어쓰므로, 현재 값만 보면 과거에 살아 있던 예금이 사라진다.
      //     기준일 이후 로그의 before_data 로 그 시점 상태를 복원한다.
      //     ⚠ 실패해도 분석 자체는 계속한다 — 복원은 정확도 향상이지 전제조건이 아니다.
      //     ⚠ 기간 필터를 걸면 안 된다 — 기준일 **이전** 로그의 after_data 도
      //       복원 재료다(before_data 가 없던 시기를 메운다). 전 구간을 가져온다.
      const auditRes = await restSelect<AuditLogRow>('audit_logs', {
        match: { company, table_name: 'investments' },
        order: 'created_at.asc', limit: 2000,
      })
      if (fetchIdRef.current !== myId) return

      // ④ 기간 내 자금일보 → 그 일보들의 입출금 항목
      const repRes = await restSelect<ReportRow>('daily_reports', {
        match: { company },
        filters: [`report_date=gte.${from}`, `report_date=lte.${to}`],
        order: 'report_date.asc', limit: 400,
      })
      if (fetchIdRef.current !== myId) return
      if (repRes.error) throw new Error(repRes.error.message)

      const repRows = repRes.data ?? []
      let itemRows: ItemRow[] = []
      if (repRows.length) {
        // PostgREST in.() — 일보가 많으면 URL 이 길어지므로 100건씩 끊어 조회한다
        const chunks: string[][] = []
        for (let i = 0; i < repRows.length; i += 100) {
          chunks.push(repRows.slice(i, i + 100).map(r => r.id))
        }
        const results = await Promise.all(chunks.map(ids =>
          restSelect<ItemRow>('daily_report_items', {
            filters: [`report_id=in.(${ids.join(',')})`], limit: 2000,
          }),
        ))
        if (fetchIdRef.current !== myId) return
        const failed = results.find(r => r.error)
        if (failed?.error) throw new Error(failed.error.message)
        itemRows = results.flatMap(r => r.data ?? [])
      }

      setDailies(inRange.data ?? [])
      setOpeningDaily((before.data ?? [])[0] ?? null)
      setInvests((invRes.data ?? []).map(investFromDb))
      setLoans(loanRes.data ?? [])
      setAuditLogs(auditRes.error ? [] : (auditRes.data ?? []))
      setReports(repRows)
      setItems(itemRows)
    } catch (e) {
      if (fetchIdRef.current === myId) setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      if (fetchIdRef.current === myId) setLoading(false)
    }
  }, [company, from, to])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // 기초·기말 날짜가 정해지면 그 두 시점의 환율을 가져온다.
  // ⚠ deps 는 문자열(primitive)만 — 배열을 넣으면 매 렌더 재조회된다(세션12차 렌더 루프).
  const openingDateForFx = openingDaily?.date ?? dailies[0]?.date ?? ''
  const closingDateForFx = dailies.length ? dailies[dailies.length - 1].date : ''
  useEffect(() => {
    if (!openingDateForFx || !closingDateForFx) { setFxRates(null); return }
    let cancelled = false
    void (async () => {
      const [open, close] = await Promise.all([
        fetchRatesOnOrBefore(FX_CODES, openingDateForFx),
        fetchRatesOnOrBefore(FX_CODES, closingDateForFx),
      ])
      if (!cancelled) setFxRates({ open, close })
    })()
    return () => { cancelled = true }
  }, [openingDateForFx, closingDateForFx])

  const {
    bridge, rows, excludedOpening, excludedClosing, investFlows, ledger, fxEffect,
    scopeOpening, scopeClosing,
  } = useMemo(() => {
    if (!company || !dailies.length) {
      return {
        bridge: null, rows: [] as FlowRow[],
        excludedOpening: null, excludedClosing: null, investFlows: null,
        ledger: [] as DailyLedgerRow[], fxEffect: null,
        scopeOpening: null, scopeClosing: null,
      }
    }

    const investById = new Map(invests.map(i => [i.id, i]))
    const reportById = new Map(reports.map(r => [r.id, r]))

    // 기초 = from 직전 영업일. 없으면(이력 시작 이전) 기간 첫날을 기초로 본다.
    const openingDate = openingDaily?.date ?? dailies[0].date
    const closingDaily = dailies[dailies.length - 1]

    const opening = scopeBalanceOn(openingDaily ?? dailies[0], invests, openingDate, fx.toKRW)
    const closing = scopeBalanceOn(closingDaily, invests, closingDaily.date, fx.toKRW)

    const flowItems: FlowItemInput[] = items.map(it => {
      const rep = reportById.get(it.report_id)
      return {
        id: it.id,
        // 일보의 report_date 는 작성일이다. 귀속일 라벨로 그대로 쓴다.
        date: rep?.report_date ?? '',
        direction: it.direction,
        category: it.category,
        // amount_krw 는 저장 시점 환율 기준. 없으면 현재 시세로 환산한다.
        amountKrw: it.amount_krw ?? toKRWAmount(it.amount, it.currency, fx.toKRW),
        currency: it.currency,
        memo: it.memo,
        linkedType: it.linked_type,
        linkedId: it.linked_id,
      }
    })

    const flows = investDeltas(invests, openingDate, closingDaily.date, fx.toKRW)

    const b = buildBridge({
      from: openingDate, to: closingDaily.date,
      opening, closing, items: flowItems, investById,
      investFlowNet: flows.net,
      openingBreakdown: investBreakdownOn(invests, openingDate, fx.toKRW),
      closingBreakdown: investBreakdownOn(invests, closingDaily.date, fx.toKRW),
    })

    const r: FlowRow[] = flowItems.map(fi => ({
      ...fi,
      group: classifyItem(fi, investById),
      reportStatus: reportById.get(items.find(x => x.id === fi.id)?.report_id ?? '')?.status ?? '',
    })).sort((a, b2) => (b2.date.localeCompare(a.date)) || (b2.amountKrw - a.amountKrw))

    // 일자별 원장 — 자금일보 항목은 '그날 몇 건 있었나'로만 곁들인다
    const itemsByDate = new Map<string, { count: number; net: number }>()
    for (const fi of flowItems) {
      const cur = itemsByDate.get(fi.date) ?? { count: 0, net: 0 }
      cur.count += 1
      cur.net += fi.direction === 'in' ? Math.abs(fi.amountKrw) : -Math.abs(fi.amountKrw)
      itemsByDate.set(fi.date, cur)
    }

    // ── 환율효과 (Phase 2) ─────────────────────────────────
    // 총액은 저장된 fx_krw 가 정본이다. ECOS 환율은 그 안에서 통화별 기여를
    // 나누는 데에만 쓰고, 맞지 않는 몫은 residual 로 드러낸다.
    const openDaily = openingDaily ?? dailies[0]
    const closeDaily = closingDaily
    const fxEffect = fxRates
      ? computeFxEffect({
          from: openDaily.date, to: closeDaily.date,
          openAmounts:  amountsOf(openDaily),
          closeAmounts: amountsOf(closeDaily),
          openRates:  fxRates.open,
          closeRates: fxRates.close,
          observedKrwDelta: (closeDaily.fx_krw ?? 0) - (openDaily.fx_krw ?? 0),
        })
      : null

    // ⭐ 시점별로 레코드를 복원한다. 기초·기말은 서로 다른 시점이므로 각각 따로 만든다.
    const investsAsOf = (d: string) => applyAsOf(
      invests, buildAsOfSnapshots(auditLogs, d), investFromDb,
    )
    const openSnap  = investsAsOf(openingDate)
    const closeSnap = investsAsOf(closingDaily.date)

    const bdOpen  = investBreakdownOn(openSnap.records,  openingDate,       fx.toKRW)
    const bdClose = investBreakdownOn(closeSnap.records, closingDaily.date, fx.toKRW)

    return {
      bridge: b, rows: r, fxEffect,
      scopeOpening: {
        date: openingDate, breakdown: bdOpen,
        scope: fundScopeOf(opening.operatingKrw, bdOpen),
        items: investItemsOn(openSnap.records, openingDate, fx.toKRW, openSnap.restoredIds),
      },
      scopeClosing: {
        date: closingDaily.date, breakdown: bdClose,
        scope: fundScopeOf(closing.operatingKrw, bdClose),
        items: investItemsOn(closeSnap.records, closingDaily.date, fx.toKRW, closeSnap.restoredIds),
      },
      ledger: buildDailyLedger({ dailies, openingDaily, invests, toKRW: fx.toKRW, itemsByDate }),
      excludedOpening: excludedBalanceOn(invests, openingDate, fx.toKRW),
      excludedClosing: excludedBalanceOn(invests, closingDaily.date, fx.toKRW),
      investFlows: flows,
    }
  }, [company, dailies, openingDaily, invests, loans, auditLogs, reports, items, fx, fxRates])

  return {
    loading, error, bridge, rows, ledger, fxEffect,
    scopeOpening, scopeClosing,
    excludedOpening, excludedClosing, investFlows,
    dailyDays: dailies.length,
    reportDays: new Set(items.map(i => i.report_id)).size,
    refetch: fetchAll,
  }
}
