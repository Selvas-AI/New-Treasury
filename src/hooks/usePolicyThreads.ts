import { useState, useEffect, useCallback } from 'react'
import { supabase, restInsert, restDelete, withTimeout } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { IssueComment } from '../types'

/** policy_decisions 후속조치 스레드 — issue_key = 'policy_{decisionId}' */
export function usePolicyThreads(decisionIds: string[]) {
  const [data, setData] = useState<IssueComment[]>([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    if (!decisionIds.length) { setData([]); return }
    setLoading(true)
    const keys = decisionIds.map(id => `policy_${id}`)
    try {
      const { data: rows } = await withTimeout(
        supabase.from('issue_comments').select('*').in('issue_key', keys).order('created_at', { ascending: true }),
      )
      setData((rows ?? []) as IssueComment[])
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [decisionIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetch() }, [fetch])

  function threadOf(decisionId: string): IssueComment[] {
    return data.filter(c => c.issue_key === `policy_${decisionId}`)
  }

  async function addMemo(
    decisionId: string,
    body: string,
    userLabel: string,
    company: string,
  ): Promise<string | null> {
    const { error: err } = await restInsert('issue_comments', {
      id: generateUUID(),
      issue_key: `policy_${decisionId}`,
      company,
      user_label: userLabel,
      user_role: 'master',
      body,
      status: 'open',
      issue_title: '',
      issue_desc: '',
    })
    if (err) return err.message
    await fetch()
    return null
  }

  async function removeMemo(id: string): Promise<void> {
    await restDelete('issue_comments', { id })
    setData(prev => prev.filter(c => c.id !== id))
  }

  return { data, loading, refetch: fetch, threadOf, addMemo, removeMemo }
}
