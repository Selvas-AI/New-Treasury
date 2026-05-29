import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { IssueComment, IssueStatus, UseQueryResult } from '../types'

/** 이슈 식별자 생성 — D-day 없이 안정화된 키 */
export function makeIssueKey(type: 'loan' | 'equity' | 'input_daily', id?: string): string {
  if (type === 'input_daily') return 'input_daily'
  if (!id) return type
  return `${type}_${id}`
}

export function useIssues(): UseQueryResult<IssueComment> & {
  /** 특정 이슈 키의 코멘트 스레드 */
  threadOf: (issueKey: string) => IssueComment[]
  /** 미완료(open + review) 이슈 수 */
  openCount: number
  addComment: (
    comment: Omit<IssueComment, 'id' | 'created_at'>
  ) => Promise<string | null>
  updateStatus: (id: string, status: IssueStatus) => Promise<string | null>
  updateComment: (id: string, body: string, status: IssueStatus) => Promise<string | null>
  remove: (id: string) => Promise<string | null>
} {
  const { user, currentCompany } = useAuth()
  const [data, setData] = useState<IssueComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = user?.role === 'company' ? user.company : currentCompany

  const fetch = useCallback(async () => {
    if (!fetchCompany) return
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('issue_comments')
      .select('*')
      .eq('company', fetchCompany)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setData((rows ?? []) as IssueComment[])
    setLoading(false)
  }, [fetchCompany])

  useEffect(() => { void fetch() }, [fetch])

  function threadOf(issueKey: string): IssueComment[] {
    return data
      .filter(c => c.issue_key === issueKey)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  const openCount = data.filter(c => c.status !== 'done').length

  async function addComment(
    comment: Omit<IssueComment, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await supabase.from('issue_comments').insert(comment)
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateStatus(id: string, status: IssueStatus): Promise<string | null> {
    const { error: err } = await supabase
      .from('issue_comments')
      .update({ status })
      .eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    return null
  }

  async function updateComment(
    id: string,
    body: string,
    status: IssueStatus,
  ): Promise<string | null> {
    const { error: err } = await supabase
      .from('issue_comments')
      .update({ body, status })
      .eq('id', id)
    if (err) return err.message
    setData(prev => prev.map(c => c.id === id ? { ...c, body, status } : c))
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase.from('issue_comments').delete().eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(c => c.id !== id))
    return null
  }

  return {
    data, loading, error, refetch: fetch,
    threadOf, openCount,
    addComment, updateStatus, updateComment, remove,
  }
}
