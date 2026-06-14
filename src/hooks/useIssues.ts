import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, restInsert, restUpdate, restDelete, withTimeout } from '../lib/supabase'
import { useAuth } from './useAuth'
import { generateUUID } from '../lib/format'
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
    setData([])
    setError(null)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('issue_comments').select('*').eq('company', fetchCompany).order('created_at', { ascending: false }),
      )
      if (err) setError(err.message)
      else setData((rows ?? []) as IssueComment[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [fetchCompany])

  useEffect(() => { void fetch() }, [fetch])

  function threadOf(issueKey: string): IssueComment[] {
    return data
      .filter(c => c.issue_key === issueKey)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  // issue_key별 최신 상태 기준으로 집계 (동일 키에 여러 코멘트가 있어도 1건으로 카운트)
  const openCount = useMemo(() => {
    const keyMap = new Map<string, IssueStatus>()
    // created_at 오름차순으로 순회해 최신 상태로 덮어씀
    ;[...data].sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach(c => keyMap.set(c.issue_key, c.status))
    return [...keyMap.values()].filter(s => s !== 'done').length
  }, [data])

  async function addComment(
    comment: Omit<IssueComment, 'id' | 'created_at'>,
  ): Promise<string | null> {
    const { error: err } = await restInsert('issue_comments', { ...comment, id: generateUUID() })
    if (err) return err.message
    await fetch()
    return null
  }

  async function updateStatus(id: string, status: IssueStatus): Promise<string | null> {
    const { error: err } = await restUpdate('issue_comments', { status }, { id })
    if (err) return err.message
    setData(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    return null
  }

  async function updateComment(
    id: string,
    body: string,
    status: IssueStatus,
  ): Promise<string | null> {
    const { error: err } = await restUpdate('issue_comments', { body, status }, { id })
    if (err) return err.message
    setData(prev => prev.map(c => c.id === id ? { ...c, body, status } : c))
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await restDelete('issue_comments', { id })
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
