/**
 * useDailyReportItems — 자금일보 입출금 라인 아이템 CRUD
 */
import { useState, useCallback } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { ReportItem } from './useDailyReportSummary'

export type { ReportItem }

export interface ThreadEntry {
  id:           string
  item_id:      string
  author_code:  string
  author_label: string | null
  body:         string
  created_at:   string
}

export interface ItemInput {
  direction:    'in' | 'out'
  category:     string
  amount:       number
  currency:     string
  amount_krw?:  number | null
  memo?:        string | null
  account_type?: string | null   // 계좌구분
  linked_type?: string | null
  linked_id?:   string | null
  sort_order?:  number
  /** 외화 항목의 적용 환율 — 원장 항목 단위 반영(fx_report_item_ledger.sql) */
  fx_rate?:     number | null
}

/**
 * fx_rate 컬럼이 아직 없는 DB(SQL 미적용)에서 저장이 통째로 실패하지 않게 한다.
 * ⚠ 자금일보 저장이 막히면 업무가 멈춘다 — 환율만 빼고 저장하고, 그 사실을 알린다.
 */
const isFxRateColumnMissing = (msg: string | undefined) => !!msg && /fx_rate/i.test(msg)

export function useDailyReportItems() {
  const [items,   setItems]   = useState<ReportItem[]>([])
  const [threads, setThreads] = useState<Record<string, ThreadEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // ── 아이템 목록 로드 ────────────────────────────────────
  const fetchItems = useCallback(async (reportId: string) => {
    setLoading(true)
    try {
      const { data, error: e } = await withTimeout(
        supabase.from('daily_report_items').select('*').eq('report_id', reportId)
          .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      )
      if (e) { setError(String(e.message)); return }
      setItems((data ?? []) as ReportItem[])
    } catch (err) {
      setError(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 아이템 추가 ─────────────────────────────────────────
  const addItem = useCallback(async (reportId: string, input: ItemInput) => {
    const id = generateUUID()
    const maxOrder = items.filter(i => i.direction === input.direction).length
    const row = {
      id,
      report_id:    reportId,
      direction:    input.direction,
      category:     input.category,
      amount:       input.amount,
      currency:     input.currency ?? 'KRW',
      amount_krw:   input.amount_krw ?? null,
      memo:         input.memo ?? null,
      account_type: input.account_type ?? null,
      linked_type:  input.linked_type ?? null,
      linked_id:    input.linked_id ?? null,
      sort_order:   input.sort_order ?? maxOrder,
      ...(input.fx_rate != null ? { fx_rate: input.fx_rate } : {}),
    }
    let { error: e } = await restInsert('daily_report_items', row)
    if (e && isFxRateColumnMissing(e.message) && 'fx_rate' in row) {
      const { fx_rate: _drop, ...rest } = row as typeof row & { fx_rate?: number }
      void _drop
      ;({ error: e } = await restInsert('daily_report_items', rest))
      if (!e) {
        setError('환율은 저장되지 않았습니다 — 외화거래명세 자동 반영은 docs/db/fx_report_item_ledger.sql 실행 후 동작합니다.')
        setItems(prev => [...prev, rest as ReportItem])
        return id
      }
    }
    if (e) { setError(String(e.message)); return null }
    setItems(prev => [...prev, row as ReportItem])
    return id
  }, [items])

  // ── 아이템 수정 ─────────────────────────────────────────
  const updateItem = useCallback(async (id: string, patch: Partial<ItemInput>): Promise<boolean> => {
    const { error: e } = await restUpdate('daily_report_items', { ...patch, updated_at: new Date().toISOString() }, { id })
    if (e) {
      setError(isFxRateColumnMissing(e.message)
        ? '환율을 저장할 수 없습니다 — docs/db/fx_report_item_ledger.sql 실행이 필요합니다.'
        : String(e.message))
      return false
    }
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
    return true
  }, [])

  // ── 아이템 삭제 ─────────────────────────────────────────
  const removeItem = useCallback(async (id: string) => {
    const { error: e } = await restDelete('daily_report_items', { id })
    if (e) { setError(String(e.message)); return }
    setItems(prev => prev.filter(i => i.id !== id))
    setThreads(prev => { const n = { ...prev }; delete n[id]; return n })
  }, [])

  // ── 스레드 로드 (기타 항목 사유) ─────────────────────────
  const fetchThreads = useCallback(async (itemId: string) => {
    try {
      const { data, error: e } = await withTimeout(
        supabase.from('daily_report_threads').select('*').eq('item_id', itemId).order('created_at', { ascending: true }),
      )
      if (e) { setError(String(e.message)); return }
      setThreads(prev => ({ ...prev, [itemId]: (data ?? []) as ThreadEntry[] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '조회 실패')
    }
  }, [])

  // ── 스레드 추가 ─────────────────────────────────────────
  const addThread = useCallback(async (
    itemId: string,
    authorCode: string,
    authorLabel: string,
    body: string,
  ) => {
    const row = {
      id:           generateUUID(),
      item_id:      itemId,
      author_code:  authorCode,
      author_label: authorLabel,
      body,
    }
    const { error: e } = await restInsert('daily_report_threads', row)
    if (e) { setError(String(e.message)); return }
    setThreads(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), { ...row, created_at: new Date().toISOString() }],
    }))
  }, [])

  // ── 외부 아이템 주입 (DailyReportPage에서 summary 훅과 동기화) ───
  const setExternalItems = useCallback((ext: ReportItem[]) => {
    setItems(ext)
  }, [])

  // ── 집계 ────────────────────────────────────────────────
  function sumKrw(dir: 'in' | 'out'): number {
    return items
      .filter(i => i.direction === dir)
      .reduce((s, i) => s + (i.amount_krw ?? i.amount), 0)
  }

  return {
    items, threads, loading, error,
    fetchItems, addItem, updateItem, removeItem,
    fetchThreads, addThread,
    setExternalItems,
    inTotal:  sumKrw('in'),
    outTotal: sumKrw('out'),
  }
}
