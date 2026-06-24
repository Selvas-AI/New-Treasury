import { useState, useCallback, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Company } from '../types'

export interface NegoLog {
  id:             string
  company:        string
  record_type:    'investment' | 'loan'
  record_id:      string
  nego_date:      string
  nego_type:      '비딩' | '금리네고' | '재예치협의' | '상환협의' | '기타'
  institution:    string
  offered_rate:   number | null
  contact_person: string | null
  outcome:        '진행중' | '채택' | '미채택' | '보류'
  notes:          string | null
  user_label:     string | null
  created_at:     string
}

export type NegoLogDraft = Omit<NegoLog, 'id' | 'created_at'>

/**
 * 법인+레코드유형 수준에서 모든 네고 이력을 한 번에 fetch.
 * byRecord Map으로 각 record_id 이력을 O(1) 조회 → N+1 없음.
 */
export function useNegoLogs(company: Company | null, recordType: 'investment' | 'loan') {
  const [data, setData]       = useState<NegoLog[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!company) { setData([]); return }
    setLoading(true)
    const { data: rows } = await supabase
      .from('rate_nego_logs')
      .select('*')
      .eq('company', company)
      .eq('record_type', recordType)
      .order('nego_date', { ascending: false })
    setData((rows ?? []) as NegoLog[])
    setLoading(false)
  }, [company, recordType])

  useEffect(() => { void fetch() }, [fetch])

  // record_id → 해당 이력 배열 Map (리렌더 안정)
  const byRecord = useMemo<Map<string, NegoLog[]>>(() => {
    const m = new Map<string, NegoLog[]>()
    for (const log of data) {
      const arr = m.get(log.record_id) ?? []
      arr.push(log)
      m.set(log.record_id, arr)
    }
    return m
  }, [data])

  async function add(draft: NegoLogDraft): Promise<string | null> {
    const { error } = await supabase
      .from('rate_nego_logs')
      .insert({ ...draft, id: crypto.randomUUID() })
    if (error) return error.message
    await fetch()
    return null
  }

  async function update(id: string, patch: Partial<NegoLogDraft>): Promise<string | null> {
    const { error } = await supabase
      .from('rate_nego_logs')
      .update(patch)
      .eq('id', id)
    if (error) return error.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error } = await supabase
      .from('rate_nego_logs')
      .delete()
      .eq('id', id)
    if (error) return error.message
    await fetch()
    return null
  }

  return { data, loading, byRecord, fetch, add, update, remove }
}
