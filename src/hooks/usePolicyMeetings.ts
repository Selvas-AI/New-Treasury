import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { PolicyMeeting } from '../types'

export function usePolicyMeetings() {
  const [data, setData] = useState<PolicyMeeting[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('policy_meetings')
      .select('*')
      .order('held_at', { ascending: false })
    if (err) setError(err.message)
    else setData((rows ?? []) as PolicyMeeting[])
    setLoading(false)
  }, [])

  useEffect(() => { void fetch() }, [fetch])

  async function addMeeting(
    m: Omit<PolicyMeeting, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await supabase.from('policy_meetings').insert(m)
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateMeeting(
    id: string,
    patch: Partial<Pick<PolicyMeeting, 'title' | 'meeting_type' | 'held_at'>>,
  ): Promise<string | null> {
    const { error: err } = await supabase.from('policy_meetings').update(patch).eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
    return null
  }

  async function removeMeeting(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('policy_meetings').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(m => m.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, addMeeting, updateMeeting, removeMeeting }
}
