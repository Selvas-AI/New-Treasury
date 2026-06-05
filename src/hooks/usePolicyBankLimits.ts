import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Company } from '../types'

export interface BankLimit {
  id:         string
  company:    Company
  bank_name:  string
  bank_type:  '은행' | '증권사' | '보험' | '기타'
  limit_pct:  number
  limit_amt:  number | null
  note:       string
  updated_by: string
  updated_at: string
}

export function usePolicyBankLimits(company: Company | null) {
  const [data,    setData]    = useState<BankLimit[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) return
    setLoading(true)
    setData([])
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('policy_bank_limits')
      .select('*')
      .eq('company', company)
      .order('bank_name')
    if (err) setError(err.message)
    else setData((rows ?? []) as BankLimit[])
    setLoading(false)
  }, [company])

  useEffect(() => { void fetch() }, [fetch])

  async function upsert(
    record: Omit<BankLimit, 'id' | 'updated_at'>,
  ): Promise<string | null> {
    const { error: err } = await supabase
      .from('policy_bank_limits')
      .upsert({ ...record, updated_at: new Date().toISOString() }, {
        onConflict: 'company,bank_name',
      })
    if (err) return err.message
    await fetch()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error: err } = await supabase
      .from('policy_bank_limits')
      .delete()
      .eq('id', id)
    if (err) return err.message
    setData(prev => prev.filter(r => r.id !== id))
    return null
  }

  return { data, loading, error, refetch: fetch, upsert, remove }
}
