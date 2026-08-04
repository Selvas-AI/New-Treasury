import { useState, useEffect, useCallback } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { PolicyDecision, DecisionStatus } from '../types'

export function usePolicyDecisions(meetingId: string | null) {
  const [data, setData] = useState<PolicyDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!meetingId) { setData([]); return }
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('policy_decisions').select('*').eq('meeting_id', meetingId).order('created_at', { ascending: true }),
      )
      if (err) setError(err.message)
      else setData((rows ?? []) as PolicyDecision[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => { void fetch() }, [fetch])

  async function addDecision(
    d: Omit<PolicyDecision, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await restInsert('policy_decisions', { ...d, id: generateUUID() })
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateDecision(
    id: string,
    patch: Partial<Pick<PolicyDecision, 'title' | 'decision' | 'owner' | 'due_date' | 'status' | 'linked_metric' | 'target_operator' | 'target_value'>>,
  ): Promise<string | null> {
    const { error: err } = await restUpdate('policy_decisions', patch, { id })
    if (err) return err.message
    setData(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
    return null
  }

  async function updateStatus(id: string, status: DecisionStatus): Promise<string | null> {
    return updateDecision(id, { status })
  }

  async function removeDecision(id: string): Promise<string | null> {
    const { error: err } = await restDelete('policy_decisions', { id })
    if (err) return err.message
    setData(prev => prev.filter(d => d.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, addDecision, updateDecision, updateStatus, removeDecision }
}

/**
 * 특정 법인의 미완료 의결사항을 회의 구분 없이 전부 조회 (세션20차 정책 이행 통제 Phase 1).
 * 대시보드/자금일보 등 "지금 이 법인이 이행해야 할 의결이 뭔지" 보여줄 때 사용.
 * usePolicyDecisions(meetingId)는 회의 단위 조회라 이 용도에 맞지 않음.
 */
export function usePolicyDecisionsByCompany(company: string | null): {
  data: PolicyDecision[]
  loading: boolean
} {
  const [data, setData] = useState<PolicyDecision[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!company) { setData([]); return }
    setLoading(true)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('policy_decisions').select('*')
          .eq('company', company).neq('status', 'completed')
          .order('due_date', { ascending: true }),
      )
      if (!err) setData((rows ?? []) as PolicyDecision[])
    } finally {
      setLoading(false)
    }
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  return { data, loading }
}
