import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { PolicyDecision, DecisionStatus } from '../types'

export function usePolicyDecisions(meetingId: string | null) {
  const [data, setData] = useState<PolicyDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!meetingId) { setData([]); return }
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('policy_decisions')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true })
    if (err) setError(err.message)
    else setData((rows ?? []) as PolicyDecision[])
    setLoading(false)
  }, [meetingId])

  useEffect(() => { void fetch() }, [fetch])

  async function addDecision(
    d: Omit<PolicyDecision, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await supabase.from('policy_decisions').insert(d)
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateDecision(
    id: string,
    patch: Partial<Pick<PolicyDecision, 'title' | 'decision' | 'owner' | 'due_date' | 'status'>>,
  ): Promise<string | null> {
    const { error: err } = await supabase.from('policy_decisions').update(patch).eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
    return null
  }

  async function updateStatus(id: string, status: DecisionStatus): Promise<string | null> {
    return updateDecision(id, { status })
  }

  async function removeDecision(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('policy_decisions').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(d => d.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, addDecision, updateDecision, updateStatus, removeDecision }
}
