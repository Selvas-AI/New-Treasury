import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, restUpsert, withTimeout } from '../lib/supabase'
import type { Company, PolicyParam } from '../types'

/** 읽기 전용 파라미터 리더 (멀티 법인 요약/표시용) */
export interface PolicyParamReader {
  get: (key: string) => number | null
  getText: (key: string) => string | null
}

export function usePolicyParams(company: Company | null) {
  const [data, setData] = useState<PolicyParam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) { setData([]); return }
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await withTimeout(
        supabase.from('policy_params').select('*').eq('company', company),
      )
      if (err) setError(err.message)
      else setData((rows ?? []) as PolicyParam[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
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
    // ⚠️ on_conflict 필수 — policy_params는 (company, param_key) UNIQUE.
    // 미지정 시 PostgREST가 PK(id)로 충돌 판정 → 기존 파라미터 갱신이
    // unique 위반(409)으로 실패하고 저장값이 이전값으로 되돌아감(예: 신뢰도 90% 복귀).
    const { error: err } = await restUpsert('policy_params', {
      company, param_key: key, param_value: value, param_text: text,
      updated_by: updatedBy, updated_at: new Date().toISOString(),
    }, false, 'company,param_key')
    if (err) return err.message
    await fetch()
    return null
  }

  return { data, loading, error, refetch: fetch, get, getText, set }
}

/**
 * 여러 법인의 정책 파라미터를 한 훅에서 읽기 전용으로 로드 — 동적 법인 목록 지원.
 * 단일 쿼리(.in('company', ...))로 모두 가져와 법인별 리더 맵 반환.
 */
export function usePolicyParamsReadMap(companies: Company[]): Record<Company, PolicyParamReader> {
  const [rows, setRows] = useState<PolicyParam[]>([])
  const key = companies.join('|')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (companies.length === 0) { setRows([]); return }
      const { data } = await supabase
        .from('policy_params').select('*').in('company', companies)
      if (!cancelled) setRows((data ?? []) as PolicyParam[])
    }
    void run()
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const out: Record<Company, PolicyParamReader> = {}
    for (const c of companies) {
      const own = rows.filter(r => r.company === c)
      out[c] = {
        get:     (k: string) => own.find(p => p.param_key === k)?.param_value ?? null,
        getText: (k: string) => own.find(p => p.param_key === k)?.param_text ?? null,
      }
    }
    return out
  }, [rows, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
