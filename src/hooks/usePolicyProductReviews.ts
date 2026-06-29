import { useState, useEffect, useCallback } from 'react'
import { restSelect, restInsert, restDelete, restUpdate } from '../lib/supabase'
import { generateUUID } from '../lib/format'

export interface ProductReview {
  id: string
  company: string
  product_name: string
  checked_items: string[]
  verdict: '적정' | '조건부' | '부적정'
  condition_note: string
  reviewer: string
  reviewed_at: string
  linked_issue_key: string | null
  linked_decision_id: string | null
}

export function usePolicyProductReviews(company: string) {
  const [data, setData] = useState<ProductReview[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) return
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await restSelect<ProductReview>(
        'policy_product_reviews',
        { match: { company }, order: 'reviewed_at.desc', limit: 20 },
      )
      if (err) { setError(err.message); return }
      setData((rows ?? []).map(r => ({
        ...r,
        checked_items: Array.isArray(r.checked_items) ? r.checked_items as string[] : [],
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  async function save(
    review: Omit<ProductReview, 'id' | 'reviewed_at' | 'linked_issue_key' | 'linked_decision_id'>,
  ): Promise<{ error: string | null; id: string }> {
    const id = generateUUID()
    const { error: err } = await restInsert('policy_product_reviews', {
      ...review,
      id,
      reviewed_at: new Date().toISOString(),
    })
    if (err) return { error: err.message, id: '' }
    await fetch()
    return { error: null, id }
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await restDelete('policy_product_reviews', { id })
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  async function linkIssue(id: string, issueKey: string): Promise<void> {
    await restUpdate('policy_product_reviews', { linked_issue_key: issueKey }, { id })
    setData(prev => prev.map(r => r.id === id ? { ...r, linked_issue_key: issueKey } : r))
  }

  async function linkDecision(id: string, decisionId: string): Promise<void> {
    await restUpdate('policy_product_reviews', { linked_decision_id: decisionId }, { id })
    setData(prev => prev.map(r => r.id === id ? { ...r, linked_decision_id: decisionId } : r))
  }

  return { data, loading, error, refetch: fetch, save, remove, linkIssue, linkDecision }
}
