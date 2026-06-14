import { useState, useEffect, useCallback } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { PolicyMeeting } from '../types'

export function usePolicyMeetings() {
  const [data, setData] = useState<PolicyMeeting[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('policy_meetings').select('*').order('held_at', { ascending: false }),
      )
      if (err) setError(err.message)
      else setData((rows ?? []) as PolicyMeeting[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetch() }, [fetch])

  async function addMeeting(
    m: Omit<PolicyMeeting, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await restInsert('policy_meetings', { ...m, id: generateUUID() })
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateMeeting(
    id: string,
    patch: Partial<Pick<PolicyMeeting, 'title' | 'meeting_type' | 'held_at'>>,
  ): Promise<string | null> {
    const { error: err } = await restUpdate('policy_meetings', patch, { id })
    if (err) return err.message
    setData(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
    return null
  }

  async function removeMeeting(id: string): Promise<string | null> {
    const { error: err } = await restDelete('policy_meetings', { id })
    if (err) return err.message
    setData(prev => prev.filter(m => m.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, addMeeting, updateMeeting, removeMeeting }
}
