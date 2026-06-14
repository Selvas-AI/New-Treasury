import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface CompanyRecord {
  id:         number
  name:       string
  short_name: string | null
  active:     boolean
  sort_order: number
}

// 3개 법인 하드코딩 폴백 (companies 테이블 미생성 환경 대비)
const FALLBACK: CompanyRecord[] = [
  { id: 1, name: '셀바스에이아이', short_name: 'AI',  active: true, sort_order: 1 },
  { id: 2, name: '셀바스헬스케어', short_name: 'HC',  active: true, sort_order: 2 },
  { id: 3, name: '메디아나',       short_name: 'MED', active: true, sort_order: 3 },
]

// 모듈 수준 캐시 — 여러 컴포넌트가 동시에 useCompanies()를 호출해도 1회만 fetch
let _cache: CompanyRecord[] | null = null
const _listeners = new Set<() => void>()

function notify() { _listeners.forEach(fn => fn()) }

async function _fetch() {
  try {
    const { data } = await supabase
      .from('companies')
      .select('id, name, short_name, active, sort_order')
      .order('sort_order')
    if (data && data.length > 0) {
      _cache = data as CompanyRecord[]
      notify()
    }
  } catch {
    // 테이블 미생성·네트워크 타임아웃 → FALLBACK 유지
  }
}

/** 비훅 헬퍼: 현재 캐시(또는 폴백)의 active 법인명 목록 — effect/검증용 (재렌더 영향 없음) */
export function getCompanyNames(): string[] {
  return (_cache ?? FALLBACK).filter(c => c.active).map(c => c.name)
}

/** 캐시를 무효화하고 재조회 (회사 추가/수정 후 호출) */
export async function invalidateCompanies() {
  _cache = null
  await _fetch()
}

export function useCompanies() {
  const [companies, setCompanies] = useState<CompanyRecord[]>(_cache ?? FALLBACK)

  useEffect(() => {
    function sync() { setCompanies(_cache ?? FALLBACK) }
    _listeners.add(sync)
    if (!_cache) void _fetch()
    else sync()
    return () => { _listeners.delete(sync) }
  }, [])

  /** active 법인명 목록 */
  const names = useMemo(
    () => companies.filter(c => c.active).map(c => c.name),
    [companies],
  )

  /** 법인명 → short_name (없으면 name 그대로) */
  const shortName = useMemo(() => {
    const map = new Map(companies.map(c => [c.name, c.short_name ?? c.name]))
    return (name: string) => map.get(name) ?? name
  }, [companies])

  return { companies, names, shortName }
}
