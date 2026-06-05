import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Company, PolicyParam } from '../types'

export function usePolicyParams(company: Company | null) {
  const [data, setData] = useState<PolicyParam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) { setData([]); return }
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('policy_params')
      .select('*')
      .eq('company', company)
    if (err) setError(err.message)
    else setData((rows ?? []) as PolicyParam[])
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  /** 특정 키 값 조회 */
  function get(key: string): number | null {
    return data.find(p => p.param_key === key)?.param_value ?? null
  }

  function getText(key: string): string | null {
    return data.find(p => p.param_key === key)?.param_text ?? null
  }

  /** upsert — param_value 또는 param_text */
  async function set(
    key: string,
    value: number | null,
    text: string | null,
    updatedBy: string,
  ): Promise<string | null> {
    if (!company) return '법인이 선택되지 않았습니다.'
    const { error: err } = await supabase
      .from('policy_params')
      .upsert(
        { company, param_key: key, param_value: value, param_text: text, updated_by: updatedBy, updated_at: new Date().toISOString() },
        { onConflict: 'company,param_key' },
      )
    if (err) return err.message
    await fetch()
    return null
  }

  return { data, loading, error, refetch: fetch, get, getText, set }
}
