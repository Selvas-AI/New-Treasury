import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface CompanyRecord {
  id:         number
  name:       string
  short_name: string | null
  active:     boolean
  sort_order: number
  /**
   * 법인별 표시 메뉴 슬러그 (navTree 의 ASSIGNABLE_SLUGS). null·undefined = 전체 표시.
   * ⚠ 권한이 아니라 노이즈 제거용 **표시 필터**다 — 사용자 권한과 AND 로 결합된다.
   * undefined 는 companies.menus 컬럼이 아직 없는 환경(마이그레이션 전)을 뜻하며,
   * null 과 똑같이 '전체 표시'로 다룬다.
   */
  menus?:     string[] | null
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
    // select('*') — menus 컬럼을 명시하면 마이그레이션 전 환경에서 400 이 나
    // 법인 목록 전체가 폴백으로 떨어진다(회사 관리·법인 선택기까지 망가짐).
    const { data } = await supabase
      .from('companies')
      .select('*')
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

/**
 * 비훅 헬퍼: 법인의 표시 메뉴 목록 — null 이면 전체 표시.
 * 캐시가 아직 안 찼으면 null(전체 표시)을 돌려준다 — 로딩 중에 메뉴를 숨기지 않는다.
 */
export function getCompanyMenus(company: string | null): string[] | null {
  if (!company) return null
  const rec = (_cache ?? FALLBACK).find(c => c.name === company)
  const m = rec?.menus
  return Array.isArray(m) ? m : null
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

  /** 법인명 → 표시 메뉴 목록 (null = 전체 표시). 캐시 갱신 시 함께 재계산된다. */
  const menusOf = useMemo(() => {
    const map = new Map(companies.map(c => [c.name, Array.isArray(c.menus) ? c.menus : null]))
    return (name: string | null) => (name ? map.get(name) ?? null : null)
  }, [companies])

  return { companies, names, shortName, menusOf }
}
