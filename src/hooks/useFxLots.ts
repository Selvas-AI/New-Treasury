import { useCallback, useEffect, useMemo, useState } from 'react'
import { restInsert, restSelect, restRpc } from '../lib/supabase'
import { availableAmount, expectedTermInterestFx, weightedBookRate, remainingAmount, type FxLot } from '../lib/fxLots'
import { inventoryMatchKey, type InventoryCsvRow } from '../lib/fxCsvImport'

/** 로트 memo 에 박아 둔 `import-key:` 회수 */
const keyOf = (memo: string | null | undefined) => memo?.match(/import-key:([^ ]+)/)?.[1] ?? null

/**
 * memo 만으로 **원래 의도된 계좌유형·만기**를 복원한다.
 *
 * 초기 이관이 account_type 컬럼 도입 전에 이뤄져 값이 memo 에만 남았다.
 *   `2026-08-11 개시재고 · term_deposit · 만기 2026-09-11 · import-key:2026-03-11|USD|term_deposit|1000000|1472.8`
 * import-key 의 3번째 필드가 계좌유형이라 가장 신뢰할 수 있다.
 *
 * ⚠ 연이율은 memo 에 없다 → CSV 가 있어야 채울 수 있다.
 *   다만 **환전 가능액을 바로잡는 데 필요한 것은 계좌유형과 만기뿐**이라,
 *   CSV 없이도 급한 교정은 가능하다.
 */
function intentFromMemo(memo: string | null | undefined): {
  accountType: FxLot['accountType']; maturityDate: string | null
} | null {
  if (!memo) return null
  const key = keyOf(memo)
  const fromKey = key?.split('|')[2]
  const fromText = memo.match(/·\s*(demand_deposit|term_deposit|mmda)\s*·/)?.[1]
  const t = (fromKey || fromText) as FxLot['accountType'] | undefined
  if (t !== 'demand_deposit' && t !== 'term_deposit' && t !== 'mmda') return null
  const maturity = memo.match(/만기\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
  return { accountType: t, maturityDate: t === 'term_deposit' ? maturity : null }
}

/** CSV 한 행과 기존 로트의 차이 — 계좌유형 교정 대상 */
export interface LotRepairPlanItem {
  lotId: string
  key: string
  date: string
  currency: string
  amount: number
  from: { accountType: FxLot['accountType']; annualInterestRate: number; maturityDate: string | null }
  to:   { accountType: FxLot['accountType']; annualInterestRate: number; maturityDate: string | null }
  acquiredDate: string
  acqRate: number
  memo: string
}

interface FxLotRow {
  id: string; company: string; currency: string; acquired_date: string
  original_amount: number; remaining_amount: number; acq_rate: number
  source_type: FxLot['sourceType']; source_id: string | null; memo: string | null
  account_type: FxLot['accountType']; annual_interest_rate: number; maturity_date: string | null
}

function mapRow(row: FxLotRow): FxLot {
  return { id: row.id, company: row.company, currency: row.currency, acquiredDate: row.acquired_date,
    originalAmount: Number(row.original_amount), remainingAmount: Number(row.remaining_amount),
    acqRate: Number(row.acq_rate), accountType: row.account_type ?? 'demand_deposit',
    annualInterestRate: Number(row.annual_interest_rate ?? 0), maturityDate: row.maturity_date,
    sourceType: row.source_type, sourceId: row.source_id, memo: row.memo }
}

export function useFxLots(company: string, currency: string) {
  const [lots, setLots] = useState<FxLot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await restSelect<FxLotRow>('fx_lots', {
      match: { company, currency }, order: 'acquired_date.asc', limit: 1000,
    })
    if (err) { setError(err.message); setLots([]) }
    else setLots((data ?? []).map(mapRow))
    setLoading(false)
  }, [company, currency])

  useEffect(() => { void refetch() }, [refetch])

  const addOpeningLot = useCallback(async (input: { date: string; amount: number; acqRate: number; accountType: FxLot['accountType']; annualInterestRate: number; maturityDate: string | null; memo: string; userCode: string }) => {
    const id = crypto.randomUUID()
    const { error: err } = await restInsert('fx_lots', { id, company, currency,
      acquired_date: input.date, original_amount: input.amount, remaining_amount: input.amount,
      acq_rate: input.acqRate, source_type: 'opening', source_id: id,
      account_type: input.accountType, annual_interest_rate: input.annualInterestRate,
      maturity_date: input.accountType === 'term_deposit' ? input.maturityDate : null,
      memo: input.memo || '개시 로트', created_by: input.userCode })
    if (!err) await refetch()
    return err?.message ?? null
  }, [company, currency, refetch])

  const importOpeningLots = useCallback(async (rows: InventoryCsvRow[], userCode: string) => {
    const { data: allRows, error: readErr } = await restSelect<FxLotRow>('fx_lots', { match: { company }, limit: 1000 })
    if (readErr) return { inserted: 0, skipped: 0, error: readErr.message }
    // ⚠ 중복 판정 키는 반드시 inventoryMatchKey(5필드)를 쓴다.
    //   과거 데이터의 memo 에는 5필드 키가 저장돼 있는데, 한때 inventoryKey 가 7필드로
    //   확장되면서 기존 키와 절대 일치하지 않게 됐다. 그 상태로 같은 CSV 를 다시 올리면
    //   60건이 통째로 중복 삽입된다(2026-08-12 발견).
    //   이자율·만기는 교정 대상이라 키에 넣어서도 안 된다.
    const existingKeys = new Set((allRows ?? []).map(row => keyOf(row.memo)).filter(Boolean))
    const pending = rows.filter(row => !existingKeys.has(inventoryMatchKey(row)))
    if (!pending.length) return { inserted: 0, skipped: rows.length, error: null as string | null }
    const payload = pending.map(row => {
      const id = crypto.randomUUID(); const key = inventoryMatchKey(row)
      return { id, company, currency: row.currency, acquired_date: row.date,
        original_amount: row.amount, remaining_amount: row.amount, acq_rate: row.bookRate,
        account_type: row.accountType, annual_interest_rate: row.annualInterestRate,
        maturity_date: row.maturityDate,
        source_type: 'opening', source_id: id,
        memo: `2026-08-11 개시재고 · ${row.accountType}${row.accountType === 'term_deposit' ? ` · 연 ${row.annualInterestRate}% · 만기 ${row.maturityDate}` : ''} · import-key:${key}`,
        created_by: userCode }
    })
    const { error: err } = await restInsert('fx_lots', payload)
    if (!err) await refetch()
    return { inserted: err ? 0 : payload.length,
      skipped: rows.length - payload.length,
      error: err?.message ?? null }
  }, [company, refetch])

  const updateLot = useCallback(async (id: string, values: { acquiredDate: string; amount: number; acqRate: number; accountType: FxLot['accountType']; annualInterestRate: number; maturityDate: string | null; memo: string }) => {
    const { error: err } = await restRpc('update_unconsumed_fx_lot', { p_lot_id:id,
      p_acquired_date:values.acquiredDate,p_amount:values.amount,p_acq_rate:values.acqRate,
      p_account_type:values.accountType,p_annual_interest_rate:values.annualInterestRate,
      p_maturity_date:values.accountType === 'term_deposit' ? values.maturityDate : null,p_memo:values.memo })
    if (!err) await refetch(); return err?.message ?? null
  }, [refetch])

  /**
   * CSV 를 기준으로 **이미 등록된 로트의 계좌유형·이자율·만기를 교정**할 목록을 만든다.
   *
   * 배경(2026-08-12): 초기 이관이 `account_type` 컬럼 도입 전에 이뤄져,
   *   계좌유형·이자율·만기가 memo 텍스트로만 남고 컬럼은 전부 기본값(demand_deposit/0/null)이었다.
   *   그 결과 만기 전 정기예금 USD 6,000,000 이 **즉시 환전 가능**으로 집계되고 있었다.
   *
   * ⚠ 여기서는 **아무것도 저장하지 않는다.** 계획만 돌려주고, 실제 반영은
   *   사용자가 화면에서 확정 버튼을 눌러 applyLotRepair 를 호출할 때만 일어난다.
   */
  const planLotRepair = useCallback(async (rows?: InventoryCsvRow[]) => {
    const { data: allRows, error: readErr } = await restSelect<FxLotRow>('fx_lots', { match: { company }, limit: 1000 })
    if (readErr) return { plan: [] as LotRepairPlanItem[], unmatched: 0, missingRate: 0, error: readErr.message }

    // CSV 가 있으면 연이율까지 채울 수 있다. 없으면 memo 만으로 계좌유형·만기를 되돌린다.
    const csvByKey = new Map<string, InventoryCsvRow>()
    for (const row of rows ?? []) csvByKey.set(inventoryMatchKey(row), row)

    const plan: LotRepairPlanItem[] = []
    let unmatched = 0     // CSV 에는 있는데 DB 에 없는 행
    let missingRate = 0   // 교정 대상인데 연이율을 못 채운 건

    for (const lot of allRows ?? []) {
      const key = keyOf(lot.memo)
      const csv = key ? csvByKey.get(key) : undefined
      const intent = intentFromMemo(lot.memo)
      // CSV 가 우선, 없으면 memo 로 복원
      const want = csv
        ? { accountType: csv.accountType,
            annualInterestRate: csv.annualInterestRate,
            maturityDate: csv.accountType === 'term_deposit' ? csv.maturityDate : null }
        : intent
        ? { accountType: intent.accountType,
            // memo 에는 연이율이 없다 → 기존 값을 유지해 덮어쓰지 않는다
            annualInterestRate: Number(lot.annual_interest_rate ?? 0),
            maturityDate: intent.maturityDate }
        : null
      if (!want) continue

      const cur = {
        accountType: (lot.account_type ?? 'demand_deposit') as FxLot['accountType'],
        annualInterestRate: Number(lot.annual_interest_rate ?? 0),
        maturityDate: lot.maturity_date ?? null,
      }
      if (cur.accountType === want.accountType
        && cur.annualInterestRate === want.annualInterestRate
        && cur.maturityDate === want.maturityDate) continue

      if (!csv && want.accountType !== 'demand_deposit' && cur.annualInterestRate === 0) missingRate++

      plan.push({
        lotId: lot.id, key: key ?? lot.id,
        date: lot.acquired_date, currency: lot.currency, amount: Number(lot.original_amount),
        from: cur, to: want,
        acquiredDate: lot.acquired_date, acqRate: Number(lot.acq_rate),
        memo: lot.memo ?? '',
      })
    }

    // CSV 를 줬는데 DB 에서 못 찾은 행 수
    if (rows?.length) {
      const dbKeys = new Set((allRows ?? []).map(r => keyOf(r.memo)).filter(Boolean))
      unmatched = rows.filter(r => !dbKeys.has(inventoryMatchKey(r))).length
    }
    return { plan, unmatched, missingRate, error: null as string | null }
  }, [company])

  /** 교정 실행 — 사용자가 확정 버튼을 누른 경우에만 호출된다 */
  const applyLotRepair = useCallback(async (plan: LotRepairPlanItem[]) => {
    let updated = 0
    const failures: string[] = []
    for (const item of plan) {
      const { error: err } = await restRpc('update_unconsumed_fx_lot', {
        p_lot_id: item.lotId,
        p_acquired_date: item.acquiredDate,
        p_amount: item.amount,
        p_acq_rate: item.acqRate,
        p_account_type: item.to.accountType,
        p_annual_interest_rate: item.to.annualInterestRate,
        p_maturity_date: item.to.maturityDate,
        p_memo: item.memo,
      })
      if (err) failures.push(`${item.date} ${item.currency} ${item.amount}: ${err.message}`)
      else updated++
    }
    if (updated) await refetch()
    return { updated, failures }
  }, [refetch])

  const deleteLot = useCallback(async (id: string) => {
    const { error: err } = await restRpc('delete_unconsumed_fx_lot', { p_lot_id:id })
    if (!err) await refetch(); return err?.message ?? null
  }, [refetch])

  /**
   * 자금일보(운전자금) 잔액 증가분을 원장 유입 로트로 반영한다.
   * source_type='daily_report_item' + source_id=daily 행의 id — unique(company,currency,
   * source_type,source_id) 제약이 같은 날짜를 두 번 반영하는 것을 DB 레벨에서 막아준다.
   * (docs/db/fx_lots_daily_report_source.sql — 사용자 실행 필요)
   */
  const reconcileDailyInflow = useCallback(async (input: {
    dailyId: string; amount: number; rate: number; date: string; userCode: string
  }) => {
    const id = crypto.randomUUID()
    const { error: err } = await restInsert('fx_lots', { id, company, currency,
      acquired_date: input.date, original_amount: input.amount, remaining_amount: input.amount,
      acq_rate: input.rate, source_type: 'daily_report_item', source_id: input.dailyId,
      account_type: 'demand_deposit', annual_interest_rate: 0, maturity_date: null,
      memo: '자금일보 잔액 증감 자동 반영', created_by: input.userCode })
    if (!err) await refetch()
    return err?.message ?? null
  }, [company, currency, refetch])

  /** 자금일보 잔액 감소분을 FIFO 소진(유출)으로 반영한다. */
  const reconcileDailyOutflow = useCallback(async (input: {
    dailyId: string; amount: number; rate: number; date: string; userCode: string
  }) => {
    const { error: err } = await restRpc('consume_fx_lots_for_source', {
      p_company: company, p_currency: currency, p_source_type: 'daily_report_item',
      p_source_id: input.dailyId, p_amount: input.amount, p_disposal_rate: input.rate,
      p_disposed_date: input.date, p_disposed_by: input.userCode,
    })
    if (!err) await refetch()
    return err?.message ?? null
  }, [company, currency, refetch])

  /**
   * 외화 유출 수동 등록 — 자금일보/매각 워크플로우를 거치지 않는 외화 지급을
   * FIFO로 직접 소진한다(세션26차 9일차, "데이터 등록" 탭 유출 입력).
   * source_type='manual' + 매번 새 source_id — 반복 등록을 막을 자연키가 없어
   * daily_report_item 처럼 unique 제약으로 중복을 막지 못한다. 사용자가 실수로
   * 두 번 누르면 두 건이 남으므로, 화면에서 저장 확정 버튼을 한 번만 누르게 안내한다.
   */
  const addManualOutflow = useCallback(async (input: {
    date: string; amount: number; rate: number; memo: string; userCode: string
  }) => {
    const sourceId = crypto.randomUUID()
    const { error: err } = await restRpc('consume_fx_lots_for_source', {
      p_company: company, p_currency: currency, p_source_type: 'manual',
      p_source_id: sourceId, p_amount: input.amount, p_disposal_rate: input.rate,
      p_disposed_date: input.date, p_disposed_by: input.userCode,
    })
    if (!err) await refetch()
    return err?.message ?? null
  }, [company, currency, refetch])

  const today = new Date().toISOString().slice(0, 10)
  return useMemo(() => ({ lots, loading, error, refetch, addOpeningLot,
    importOpeningLots, updateLot, deleteLot, planLotRepair, applyLotRepair,
    reconcileDailyInflow, reconcileDailyOutflow, addManualOutflow,
    totalAmount: remainingAmount(lots),
    availableAmount: availableAmount(lots, today), lockedAmount: remainingAmount(lots)-availableAmount(lots, today),
    expectedInterestFx: lots.reduce((sum, lot) => sum + expectedTermInterestFx(lot), 0),
    bookRate: weightedBookRate(lots) }),
  [lots, loading, error, refetch, addOpeningLot, importOpeningLots, updateLot, deleteLot,
   planLotRepair, applyLotRepair, reconcileDailyInflow, reconcileDailyOutflow, addManualOutflow, today])
}
